import { ObjectId, type Db } from "mongodb";
import type { Express } from "express";
import { rangeBounds, type TimeRange } from "../analytics/range";
import { authPayload, requireAuth } from "../auth/routes";
import { historyTop } from "../dashboard/routes";
import { buildSessions, type StoredPlay as SessionPlay } from "../sessions/routes";
import { buildStats } from "../stats/routes";
import { decryptSecret, encryptSecret } from "../spotify/client";

const RANGES = ["short_term", "medium_term", "long_term"] as const;
const PROVIDERS = ["openai", "anthropic", "gemini", "huggingface", "ollama", "lmstudio"] as const;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 1_000;
const MAX_TOOL_ROUNDS = 4;
type AssistantRange = TimeRange;
type Provider = typeof PROVIDERS[number];
type ChatMessage = { role: "user" | "assistant"; content: string };
type AssistantPlay = SessionPlay & { albumName?: string | null };
type AssistantConfig = { provider: Provider; model: string; encryptedApiKey?: string; localPort?: number };
type UserWithAssistant = { assistant?: Partial<AssistantConfig> };
type ToolCall = { type: "function_call"; call_id: string; name: string; arguments: string };
type OpenAIResponse = { output: unknown[]; output_text?: string };

const instructions = "You are MusiStats, a helpful assistant for one listener's music history. Answer only from tool results. Use a tool before making claims about listening data. Be concise, state the period used, and say when data is unavailable or a request is outside the supported periods. You can discuss playlist ideas, but you cannot create, edit, or save playlists. Never claim an action was performed.";
const tools = [
  { type: "function", name: "get_top_items", description: "Get the user's top artists, tracks, or albums for a listening period.", strict: true, parameters: { type: "object", properties: { range: { type: "string", enum: RANGES, description: "short_term is 4 weeks, medium_term is 6 months, long_term is all available history." }, kind: { type: "string", enum: ["artists", "tracks", "albums"] } }, required: ["range", "kind"], additionalProperties: false } },
  { type: "function", name: "get_listening_stats", description: "Get listening time, song count, artist count, and top artists for a listening period.", strict: true, parameters: { type: "object", properties: { range: { type: "string", enum: RANGES, description: "short_term is 4 weeks, medium_term is 6 months, long_term is all available history." } }, required: ["range"], additionalProperties: false } },
  { type: "function", name: "get_listening_sessions", description: "Get the user's longest listening sessions for a listening period.", strict: true, parameters: { type: "object", properties: { range: { type: "string", enum: RANGES, description: "short_term is 4 weeks, medium_term is 6 months, long_term is all available history." } }, required: ["range"], additionalProperties: false } },
];

function isProvider(value: unknown): value is Provider { return typeof value === "string" && PROVIDERS.includes(value as Provider); }
function isLocalProvider(provider: Provider) { return provider === "ollama" || provider === "lmstudio"; }
function isLocalPort(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535; }
function isRange(value: unknown): value is AssistantRange { return typeof value === "string" && RANGES.includes(value as AssistantRange); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function parseObject(value: string): Record<string, unknown> { try { return asRecord(JSON.parse(value)); } catch { return {}; } }
function isToolCall(value: unknown): value is ToolCall { const call = asRecord(value); return call.type === "function_call" && typeof call.call_id === "string" && typeof call.name === "string" && typeof call.arguments === "string"; }

export function parseChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_MESSAGES) return null;
  const messages = value.map((message) => {
    const { role, content } = asRecord(message);
    return (role === "user" || role === "assistant") && typeof content === "string" && content.trim() && content.length <= MAX_MESSAGE_LENGTH ? { role, content: content.trim() } as ChatMessage : null;
  });
  return messages.every((message): message is ChatMessage => message !== null) && messages.at(-1)?.role === "user" ? messages : null;
}

function configFrom(value: unknown): AssistantConfig | null {
  const { provider, model, encryptedApiKey, localPort } = asRecord(value);
  return isProvider(provider) && typeof model === "string" && model.trim() && model.length <= 160 && (isLocalProvider(provider) || typeof encryptedApiKey === "string" && encryptedApiKey) && (!isLocalProvider(provider) || localPort === undefined || isLocalPort(localPort)) ? { provider, model, ...(typeof encryptedApiKey === "string" && encryptedApiKey ? { encryptedApiKey } : {}), ...(isLocalPort(localPort) ? { localPort } : {}) } : null;
}

async function userConfig(db: Db, userId: string): Promise<AssistantConfig | null> {
  if (!ObjectId.isValid(userId)) return null;
  return configFrom((await db.collection<UserWithAssistant>("Users").findOne({ _id: new ObjectId(userId) }))?.assistant);
}

function filterFor(userId: string, range: AssistantRange) {
  const bounds = rangeBounds(range, new Date());
  return !bounds || !bounds.start && !bounds.end ? { userId } : { userId, playedAt: { ...(bounds.start ? { $gte: bounds.start } : {}), ...(bounds.end ? { $lt: bounds.end } : {}) } };
}

async function runTool(db: Db, userId: string, name: string, rawArguments: string) {
  const args = parseObject(rawArguments);
  if (!isRange(args.range)) return { error: "invalid_tool_arguments" };
  const range = args.range;
  const plays = await db.collection<AssistantPlay>("RecentPlays").find(filterFor(userId, range)).sort({ playedAt: 1 }).toArray();
  if (name === "get_top_items") {
    if (args.kind !== "artists" && args.kind !== "tracks" && args.kind !== "albums") return { error: "invalid_tool_arguments" };
    return { range, items: historyTop(plays)[args.kind] };
  }
  if (name === "get_listening_stats") return { range, stats: buildStats(range, new Date(), plays, plays[0]?.playedAt ?? null) };
  if (name === "get_listening_sessions") return { range, sessions: buildSessions(userId, plays).slice(0, 10).map(({ tracks: _tracks, ...session }) => session) };
  return { error: "unknown_tool" };
}

async function request(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`AI provider request failed (${response.status})`);
  return await response.json() as unknown;
}

function outputText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  for (const item of response.output) {
    const content = asRecord(item).content;
    if (!Array.isArray(content)) continue;
    const text = asRecord(content.find((part) => asRecord(part).type === "output_text")).text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "I couldn't produce an answer from your listening data.";
}

async function answerOpenAICompatible(url: string, config: AssistantConfig, apiKey: string, db: Db, userId: string, messages: ChatMessage[]) {
  let input: unknown[] = messages.map((message) => ({ role: message.role, content: message.content }));
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await request(url, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, { model: config.model, instructions, input, tools, parallel_tool_calls: false, max_output_tokens: 500, store: false }) as OpenAIResponse;
    const calls = Array.isArray(response.output) ? response.output.filter(isToolCall) : [];
    if (!calls.length) return outputText(response);
    const outputs = await Promise.all(calls.map(async (call) => ({
      type: "function_call_output", call_id: call.call_id, output: JSON.stringify(await runTool(db, userId, call.name, call.arguments)),
    })));
    input = [...input, ...response.output, ...outputs];
  }
  return "I couldn't complete that analysis. Please try a simpler question.";
}

function anthropicTools() { return tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters })); }

async function answerAnthropic(config: AssistantConfig, apiKey: string, db: Db, userId: string, messages: ChatMessage[]) {
  let history: unknown[] = messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = asRecord(await request("https://api.anthropic.com/v1/messages", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, { model: config.model, max_tokens: 500, system: instructions, messages: history, tools: anthropicTools() }));
    const content = Array.isArray(response.content) ? response.content : [];
    const calls = content.filter((item) => asRecord(item).type === "tool_use");
    if (!calls.length) {
      const text = asRecord(content.find((item) => asRecord(item).type === "text")).text;
      return typeof text === "string" && text.trim() ? text.trim() : "I couldn't produce an answer from your listening data.";
    }
    history = [...history, { role: "assistant", content }, { role: "user", content: await Promise.all(calls.map(async (call) => ({ type: "tool_result", tool_use_id: asRecord(call).id, content: JSON.stringify(await runTool(db, userId, String(asRecord(call).name), JSON.stringify(asRecord(call).input))) }))) }];
  }
  return "I couldn't complete that analysis. Please try a simpler question.";
}

function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  const item = asRecord(value);
  if (!Object.keys(item).length) return value;
  return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, key === "type" && typeof child === "string" ? child.toUpperCase() : geminiSchema(child)]));
}

async function answerGemini(config: AssistantConfig, apiKey: string, db: Db, userId: string, messages: ChatMessage[]) {
  let contents: unknown[] = messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
  const geminiTools = [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters: geminiSchema(parameters) })) }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = asRecord(await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, { "x-goog-api-key": apiKey }, { systemInstruction: { parts: [{ text: instructions }] }, contents, tools: geminiTools }));
    const content = asRecord(asRecord(Array.isArray(response.candidates) ? response.candidates[0] : undefined).content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const calls = parts.map((part) => asRecord(asRecord(part).functionCall)).filter((call) => typeof call.name === "string");
    if (!calls.length) {
      const text = asRecord(parts.find((part) => typeof asRecord(part).text === "string")).text;
      return typeof text === "string" && text.trim() ? text.trim() : "I couldn't produce an answer from your listening data.";
    }
    const results = await Promise.all(calls.map(async (call) => {
      const name = call.name as string;
      return { functionResponse: { name, ...(typeof call.id === "string" ? { id: call.id } : {}), response: { result: await runTool(db, userId, name, JSON.stringify(call.args ?? {})) } } };
    }));
    contents = [...contents, content, { role: "user", parts: results }];
  }
  return "I couldn't complete that analysis. Please try a simpler question.";
}

async function answer(config: AssistantConfig, db: Db, userId: string, messages: ChatMessage[]) {
  const apiKey = config.encryptedApiKey ? decryptSecret(config.encryptedApiKey) : "";
  if (config.provider === "anthropic") return answerAnthropic(config, apiKey, db, userId, messages);
  if (config.provider === "gemini") return answerGemini(config, apiKey, db, userId, messages);
  const url = config.provider === "huggingface" ? "https://router.huggingface.co/v1/responses" : config.provider === "ollama" ? `http://127.0.0.1:${config.localPort ?? 11434}/v1/responses` : config.provider === "lmstudio" ? `http://127.0.0.1:${config.localPort ?? 1234}/v1/responses` : "https://api.openai.com/v1/responses";
  return answerOpenAICompatible(url, config, apiKey, db, userId, messages);
}

export function registerAssistantRoutes(app: Express, db: Db) {
  app.post("/api/assistant/settings", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: "unauthorized" });
    if (req.body?.remove === true) {
      await db.collection("Users").updateOne({ _id: new ObjectId(userId) }, { $unset: { assistant: "" } });
      return res.json({ error: "", configured: false });
    }
    if (req.body?.provider === undefined) {
      const config = await userConfig(db, userId);
      return res.json({ error: "", configured: Boolean(config), ...(config ? { provider: config.provider, model: config.model, ...(config.localPort ? { localPort: config.localPort } : {}) } : {}) });
    }
    const { provider, model, apiKey, localPort } = req.body ?? {};
    if (!isProvider(provider) || typeof model !== "string" || !model.trim() || model.length > 160 || isLocalProvider(provider) && localPort !== undefined && !isLocalPort(localPort) || !isLocalProvider(provider) && (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 500)) return res.status(400).json({ error: "invalid_request" });
    await db.collection("Users").updateOne({ _id: new ObjectId(userId) }, { $set: { assistant: { provider, model: model.trim(), ...(isLocalProvider(provider) && isLocalPort(localPort) ? { localPort } : {}), ...(isLocalProvider(provider) ? {} : { encryptedApiKey: encryptSecret(apiKey.trim()) }), updatedAt: new Date() } } });
    return res.json({ error: "", configured: true, provider, model: model.trim(), ...(isLocalProvider(provider) && isLocalPort(localPort) ? { localPort } : {}) });
  });

  app.post("/api/assistant", requireAuth, async (req, res) => {
    const messages = parseChatMessages(req.body?.messages);
    if (!messages) return res.status(400).json({ error: "invalid_request" });
    const { userId } = authPayload(req);
    const config = await userConfig(db, userId);
    if (!config) return res.status(503).json({ error: "assistant_unavailable" });
    try { res.json({ error: "", reply: await answer(config, db, userId, messages) }); }
    catch (error) { console.error(`Assistant request failed for ${userId}:`, error); res.status(503).json({ error: "assistant_unavailable" }); }
  });
}
