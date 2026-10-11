import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, type webcrypto } from "node:crypto";
import jwt from "jsonwebtoken";
import { ObjectId, type Db } from "mongodb";
import type { Express, Response } from "express";
import { authPayload, requireAuth } from "../auth/routes";
import { decryptSecret, encryptSecret } from "../spotify/client";

// Sign in with ChatGPT, ChatGPT plan usage for open-source and locally hosted apps:
// https://developers.openai.com/siwc/token-sharing-open-source
const ISSUER = "https://auth.openai.com";
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const REVOKE_URL = `${ISSUER}/api/accounts/oauth/revoke`;
const RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
const CALLBACK_PATH = "/api/assistant/chatgpt/callback";
const PENDING_COOKIE = "chatgptOauth";
const TEN_MINUTES = 10 * 60 * 1000;
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
const DEAD_REFRESH_CODES = ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"];
const TOKEN_FIELDS = { "chatgpt.encryptedAccessToken": "", "chatgpt.encryptedRefreshToken": "", "chatgpt.expiresAt": "" } as const;

type ChatGPTAccount = { clientId: string; subject: string; email?: string; encryptedAccessToken?: string; encryptedRefreshToken?: string; expiresAt?: Date };
type ChatGPTUser = { chatgpt?: ChatGPTAccount; assistant?: { provider?: string; model?: string; updatedAt?: Date } };
type Pending = { userId: string; state: string; nonce: string; verifier: string; clientId: string | null; expiresAt: number };

export class ChatGPTError extends Error {
  constructor(readonly code: string) { super(`ChatGPT request failed (${code})`); }
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parse(value: string): Record<string, unknown> { try { return record(JSON.parse(value)); } catch { return {}; } }
function random() { return randomBytes(24).toString("base64url"); }

function errorCode(body: unknown, fallback: string) {
  const error = record(body).error;
  const code = typeof error === "string" ? error : record(error).code;
  return typeof code === "string" && code ? code : fallback;
}

// OpenAI accepts only an http://127.0.0.1 loopback callback in this flow, so sign-in works only when the browser and MusiStats share a machine.
export function chatgptRedirectUri(): string | null {
  const value = process.env.CHATGPT_REDIRECT_URI ?? "";
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === CALLBACK_PATH ? value : null;
}

export function chatgptStatus(value: unknown) {
  const account = record(value);
  return { available: Boolean(chatgptRedirectUri()), connected: Boolean(account.encryptedRefreshToken), ...(typeof account.email === "string" ? { email: account.email } : {}) };
}

// A saved client ID means this user already registered MusiStats with their ChatGPT account; otherwise this is a first-time registration.
export function chatgptAuthorizeUrl({ redirectUri, hostId, state, nonce, verifier, clientId, email }: { redirectUri: string; hostId: string; state: string; nonce: string; verifier: string; clientId: string | null; email?: string }) {
  return `${ISSUER}/api/accounts/authorize?${new URLSearchParams({
    ...(clientId ? { client_id: clientId, ...(email ? { login_hint: email } : {}) } : { client_id: REGISTRATION_CLIENT_ID, agent_name_hint: "MusiStats" }),
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPE,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  })}`;
}

// One stable, opaque ID for this MusiStats install, created on first use.
async function hostId(db: Db) {
  const host = await db.collection<{ _id: string; value: string }>("Config").findOneAndUpdate({ _id: "chatgptHostId" }, { $setOnInsert: { value: `urn:uuid:${randomUUID()}` } }, { upsert: true, returnDocument: "after" });
  if (!host) throw new Error("Could not create the ChatGPT host ID");
  return host.value;
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(TOKEN_URL, { method: "POST", headers: FORM, body: new URLSearchParams({ ...params, resource: RESOURCE }) });
  const body = record(await response.json().catch(() => null));
  if (!response.ok) throw new ChatGPTError(errorCode(body, `http_${response.status}`));
  if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") throw new ChatGPTError("invalid_token_response");
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : "",
    idToken: typeof body.id_token === "string" ? body.id_token : "",
    scopes: typeof body.scope === "string" ? body.scope.split(" ") : [],
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
  };
}

async function verifyIdToken(idToken: string, clientId: string, nonce: string) {
  const kid = jwt.decode(idToken, { complete: true })?.header.kid;
  const { keys } = await (await fetch(`${ISSUER}/.well-known/jwks.json`)).json() as { keys: (webcrypto.JsonWebKey & { kid?: string })[] };
  const key = keys.find((item) => item.kid === kid);
  if (!key) throw new ChatGPTError("unknown_signing_key");
  const payload = jwt.verify(idToken, createPublicKey({ key, format: "jwk" }), { algorithms: ["RS256"], issuer: ISSUER, audience: clientId, nonce, clockTolerance: 5 });
  if (typeof payload === "string" || typeof payload.sub !== "string") throw new ChatGPTError("invalid_id_token");
  return { subject: payload.sub, ...(typeof payload.email === "string" ? { email: payload.email } : {}) };
}

function encryptedTokens(tokens: { accessToken: string; refreshToken: string; expiresAt: Date }) {
  return { encryptedAccessToken: encryptSecret(tokens.accessToken), encryptedRefreshToken: encryptSecret(tokens.refreshToken), expiresAt: tokens.expiresAt };
}

async function currentAccessToken(db: Db, userId: string) {
  if (!ObjectId.isValid(userId)) throw new ChatGPTError("signin_required");
  const users = db.collection<ChatGPTUser>("Users");
  const _id = new ObjectId(userId);
  const account = (await users.findOne({ _id }))?.chatgpt;
  if (!account?.encryptedAccessToken || !account.encryptedRefreshToken || !account.expiresAt) throw new ChatGPTError("signin_required");
  if (account.expiresAt.getTime() - Date.now() > 60_000) return decryptSecret(account.encryptedAccessToken);
  try {
    const tokens = await tokenRequest({ grant_type: "refresh_token", client_id: account.clientId, refresh_token: decryptSecret(account.encryptedRefreshToken) });
    if (!tokens.refreshToken) throw new ChatGPTError("invalid_token_response");
    const saved = encryptedTokens(tokens);
    await users.updateOne({ _id }, { $set: { "chatgpt.encryptedAccessToken": saved.encryptedAccessToken, "chatgpt.encryptedRefreshToken": saved.encryptedRefreshToken, "chatgpt.expiresAt": saved.expiresAt } });
    return tokens.accessToken;
  } catch (error) {
    if (!(error instanceof ChatGPTError) || !DEAD_REFRESH_CODES.includes(error.code)) throw error;
    await users.updateOne({ _id }, { $unset: TOKEN_FIELDS });
    throw new ChatGPTError("signin_required");
  }
}

// ponytail: refresh tokens rotate, so refreshes for one user are serialized in this process; use a database lease if the API ever runs as several processes.
const tokenLoads = new Map<string, Promise<string>>();
export function chatgptAccessToken(db: Db, userId: string): Promise<string> {
  const running = tokenLoads.get(userId);
  if (running) return running;
  const load = currentAccessToken(db, userId).finally(() => tokenLoads.delete(userId));
  tokenLoads.set(userId, load);
  return load;
}

// Ends the renewable session and deletes the tokens, but keeps the registration so a later sign-in reuses the same client ID.
export async function chatgptSignOut(db: Db, userId: string) {
  if (!ObjectId.isValid(userId)) return;
  const users = db.collection<ChatGPTUser>("Users");
  const _id = new ObjectId(userId);
  const account = (await users.findOne({ _id }))?.chatgpt;
  if (!account?.encryptedRefreshToken) return;
  // Revocation is best effort: the tokens are deleted here either way, and the user can also disconnect MusiStats in ChatGPT settings.
  await fetch(REVOKE_URL, { method: "POST", headers: FORM, body: new URLSearchParams({ token: decryptSecret(account.encryptedRefreshToken), token_type_hint: "refresh_token", client_id: account.clientId }) })
    .then((response) => { if (!response.ok) console.error(`ChatGPT session revocation failed for ${userId} (${response.status})`); })
    .catch((error) => console.error(`ChatGPT session revocation failed for ${userId}:`, error));
  await users.updateOne({ _id }, { $unset: TOKEN_FIELDS });
}

export async function chatgptModels(accessToken: string) {
  const response = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = record(await response.json().catch(() => null));
  if (!response.ok) throw new ChatGPTError(errorCode(body, `http_${response.status}`));
  return (Array.isArray(body.models) ? body.models : []).map(record).flatMap((model) => model.visibility === "list" && typeof model.slug === "string" ? [{ slug: model.slug, name: typeof model.display_name === "string" ? model.display_name : model.slug }] : []);
}

// Plan-usage requests must stream. The terminal `response.completed` event confirms success, but on this route its
// `output` is empty: the messages and tool calls arrive only as `response.output_item.done` events.
export function completedResponse(stream: string): Record<string, unknown> {
  const items: unknown[] = [];
  for (const line of stream.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const event = parse(line.slice(5));
    if (event.type === "response.output_item.done") items.push(event.item);
    if (event.type === "response.completed") {
      const response = record(event.response);
      return Array.isArray(response.output) && response.output.length ? response : { ...response, output: items };
    }
    if (event.type === "response.failed") throw new ChatGPTError(errorCode(event.response, "response_failed"));
    if (event.type === "error") throw new ChatGPTError(errorCode({ error: event.error ?? event.code }, "response_failed"));
  }
  throw new ChatGPTError("response_incomplete");
}

export async function chatgptResponse(accessToken: string, body: Record<string, unknown>) {
  const response = await fetch(`${RESOURCE}/responses`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, store: false, stream: true }) });
  if (!response.ok) throw new ChatGPTError(errorCode(await response.json().catch(() => null), `http_${response.status}`));
  return completedResponse(await response.text());
}

function pendingFrom(cookie: unknown): Pending | null {
  if (typeof cookie !== "string") return null;
  try {
    const { userId, state, nonce, verifier, clientId, expiresAt } = parse(decryptSecret(cookie));
    return typeof userId === "string" && ObjectId.isValid(userId) && typeof state === "string" && typeof nonce === "string" && typeof verifier === "string" && (clientId === null || typeof clientId === "string") && typeof expiresAt === "number" && expiresAt > Date.now()
      ? { userId, state, nonce, verifier, clientId, expiresAt } : null;
  } catch { return null; }
}

function sameText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerChatGPTRoutes(app: Express, db: Db) {
  const users = db.collection<ChatGPTUser>("Users");
  // The callback is always plain-http loopback, so this cookie cannot be marked Secure.
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, path: CALLBACK_PATH };

  app.post("/api/assistant/chatgpt/start", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    const redirectUri = chatgptRedirectUri();
    if (!redirectUri || !ObjectId.isValid(userId)) return res.status(400).json({ error: "chatgpt_unavailable" });
    const account = (await users.findOne({ _id: new ObjectId(userId) }))?.chatgpt;
    const pending: Pending = { userId, state: random(), nonce: random(), verifier: randomBytes(64).toString("base64url"), clientId: account?.clientId ?? null, expiresAt: Date.now() + TEN_MINUTES };
    // The encrypted cookie ties the callback to this browser and this MusiStats user.
    res.cookie(PENDING_COOKIE, encryptSecret(JSON.stringify(pending)), { ...cookieOptions, maxAge: TEN_MINUTES });
    res.json({ error: "", url: chatgptAuthorizeUrl({ ...pending, redirectUri, hostId: await hostId(db), email: account?.email }) });
  });

  app.get(CALLBACK_PATH, async (req, res) => {
    const query = (name: string) => typeof req.query[name] === "string" ? req.query[name] : "";
    const finish = (res: Response, outcome: string) => res.redirect(`/?chatgpt=${outcome}`);
    const pending = pendingFrom(req.cookies?.[PENDING_COOKIE]);
    const redirectUri = chatgptRedirectUri();
    res.clearCookie(PENDING_COOKIE, cookieOptions);
    if (!pending || !redirectUri || !query("state") || !sameText(query("state"), pending.state)) return finish(res, "failed");
    if (query("error") || !query("code")) return finish(res, query("error") === "access_denied" ? "denied" : "failed");
    // A first registration is issued its client ID in the callback; a returning sign-in must come back with the saved one.
    const clientId = pending.clientId ?? query("client_id");
    if (!clientId || clientId === REGISTRATION_CLIENT_ID || query("client_id") && query("client_id") !== clientId) return finish(res, "failed");

    try {
      const _id = new ObjectId(pending.userId);
      const tokens = await tokenRequest({ grant_type: "authorization_code", client_id: clientId, code: query("code"), code_verifier: pending.verifier, redirect_uri: redirectUri });
      const identity = await verifyIdToken(tokens.idToken, clientId, pending.nonce);
      const user = await users.findOne({ _id });
      if (!user || pending.clientId && user.chatgpt?.subject !== identity.subject) return finish(res, "failed");
      // Without the plan permission there is nothing to use, so the registration is not kept and the next attempt asks for consent again.
      if (!tokens.scopes.includes(PLAN_SCOPE) || !tokens.refreshToken) return finish(res, "plan_disabled");
      const model = user.assistant?.provider === "chatgpt" && user.assistant.model || (await chatgptModels(tokens.accessToken))[0]?.slug;
      if (!model) return finish(res, "failed");
      await users.updateOne({ _id }, { $set: { chatgpt: { clientId, ...identity, ...encryptedTokens(tokens) }, assistant: { provider: "chatgpt", model, updatedAt: new Date() } } });
      return finish(res, pending.clientId ? "reconnected" : "connected");
    } catch (error) {
      console.error(`ChatGPT sign-in failed for ${pending.userId}:`, error);
      return finish(res, "failed");
    }
  });

  app.post("/api/assistant/chatgpt/models", requireAuth, async (req, res) => {
    try { res.json({ error: "", models: await chatgptModels(await chatgptAccessToken(db, authPayload(req).userId)) }); }
    catch (error) { console.error("ChatGPT model list failed:", error); res.status(503).json({ error: "chatgpt_unavailable" }); }
  });
}
