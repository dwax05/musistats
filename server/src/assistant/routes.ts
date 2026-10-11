import { ObjectId, type Db } from "mongodb";
import type { Express } from "express";
import { CUSTOM_TIME_RANGE, TIME_RANGES, isAnalyticsRange, rangeBounds, rangeStart } from "../analytics/range";
import { authPayload, requireAuth } from "../auth/routes";
import { historyTop } from "../dashboard/routes";
import { normalizeForFingerprint } from "../imports/model";
import { buildSessions, type StoredPlay as SessionPlay } from "../sessions/routes";
import { buildStats } from "../stats/routes";
import { decryptSecret, encryptSecret } from "../spotify/client";
import { getLastFmGenresByArtistName } from "../taste/lastfm";
import { buildTasteReplay, type GenreWeight } from "../taste/model";
import { scheduleGenreEnrichment } from "../taste/routes";
import { ChatGPTError, chatgptAccessToken, chatgptResponse, chatgptSignOut, chatgptStatus, registerChatGPTRoutes } from "./chatgpt";

const PROVIDERS = ["openai", "chatgpt", "anthropic", "gemini", "huggingface", "ollama", "lmstudio"] as const;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 1_000;
const MAX_TOOL_ROUNDS = 4;
const MAX_QUERY_LENGTH = 4_000;
const MAX_QUERY_ROWS = 50;
const MAX_QUERY_RESULT_LENGTH = 20_000;
const TASTE_ARTISTS = 25;
const TASTE_NAMES = 5;
// Popular Last.fm tags that describe the tagger rather than the music.
const NON_GENRE_TAGS = ["seen live", "favorites", "favourites", "favorite", "favourite", "albums i own"];
// query_plays may only use stages that reshape the plays already in the pipeline.
const QUERY_STAGES = ["$match", "$group", "$sort", "$limit", "$skip", "$project", "$addFields", "$set", "$unset", "$unwind", "$count", "$sortByCount", "$bucket", "$bucketAuto"];
// Refused anywhere in a query: these read other collections, write, or run JavaScript on the database server.
const FORBIDDEN_OPERATORS = ["$lookup", "$unionWith", "$graphLookup", "$facet", "$documents", "$out", "$merge", "$function", "$accumulator", "$where"];
type Provider = typeof PROVIDERS[number];
type ChatMessage = { role: "user" | "assistant"; content: string };
type AssistantPlay = SessionPlay & { albumName?: string | null };
type AssistantConfig = { provider: Provider; model: string; encryptedApiKey?: string; localPort?: number };
type UserWithAssistant = { assistant?: Partial<AssistantConfig>; chatgpt?: unknown };
type ToolCall = { type: "function_call"; call_id: string; name: string; arguments: string };
type OpenAIResponse = { output: unknown[]; output_text?: string };

// The date lets the model turn "a year ago today" or "last March" into a custom period.
function instructions(taste = "") {
  return `You are MusiStats, a helpful assistant for one listener's music history. Today is ${new Date().toISOString().slice(0, 10)} (UTC). Answer only from tool results. Use a tool before making claims about listening data. Tools accept the preset periods or any custom date range, so work out the dates for requests like a specific day, month, or year. Be concise, reply in plain text without Markdown, state the period used, and say when data is unavailable. You can discuss playlist ideas, but you cannot create, edit, or save playlists. Never claim an action was performed.${taste}`;
}
// Names come from Last.fm tags and uploaded exports, so only a few short, single-line ones reach the prompt.
function promptNames(names: string[]) { return names.map((name) => name.replace(/[^\p{L}\p{N} &'.,!$/+-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, TASTE_NAMES); }

// `artists` is ranked most played first. Genres are weighted the way Taste Replay weights them, so the chat and that page agree.
export function tasteNote(artists: string[], genresByArtist: Map<string, GenreWeight[]>): string {
  const names = promptNames(artists);
  if (!names.length) return "";
  const ranked = artists.map((name) => ({ genres: [], genreWeights: genresByArtist.get(normalizeForFingerprint(name)) }));
  const genres = promptNames(buildTasteReplay({ short_term: [], medium_term: ranked, long_term: [] }).medium_term.map((genre) => genre.name).filter((name) => !NON_GENRE_TAGS.includes(name.toLowerCase())));
  return ` For tone only: this listener's recent favourites are ${names.join(", ")}${genres.length ? `, mostly ${genres.join(", ")}` : ""}. Sound like a friend who loves the same music, with a little warmth or one fitting turn of phrase per reply at most. Keep it subtle: no parody, impressions, or stereotypes, and stay just as concise. Do not present this note as listening data, and never let style change a fact or a number.`;
}

// A failed lookup only costs the personal touch, never the answer. Genres are read from the cache so chat never waits on Last.fm.
async function tasteFor(db: Db, userId: string): Promise<string> {
  try {
    const rows = await db.collection("RecentPlays").aggregate([{ $match: { userId, playedAt: { $gte: rangeStart("medium_term", new Date()) } } }, { $unwind: "$artists" }, { $sortByCount: "$artists" }, { $limit: TASTE_ARTISTS }], { maxTimeMS: 5_000 }).toArray();
    const artists = rows.map((row) => row._id as unknown).filter((name): name is string => typeof name === "string");
    const { genresByArtist } = await getLastFmGenresByArtistName(db, artists, [], { lookupMissing: false });
    const missing = artists.filter((name) => !genresByArtist.has(normalizeForFingerprint(name)));
    if (missing.length) scheduleGenreEnrichment(userId, db, missing);
    return tasteNote(artists, genresByArtist);
  } catch { return ""; }
}
// Every tool takes the same period. Dates are empty strings rather than optional so the schema stays valid for every provider.
const period = {
  range: { type: "string", enum: [...TIME_RANGES, CUSTOM_TIME_RANGE], description: "short_term is the last 4 weeks, medium_term is the last 6 months, long_term is the last 12 months. Use custom with startDate and endDate for any other period, such as one day, a month, a calendar year, or all history (use an early startDate)." },
  startDate: { type: "string", description: "First day of a custom period as YYYY-MM-DD in UTC. Empty string unless range is custom." },
  endDate: { type: "string", description: "Last day of a custom period, inclusive, as YYYY-MM-DD in UTC. Empty string unless range is custom." },
};
const periodFields = Object.keys(period);
const tools = [
  { type: "function", name: "get_top_items", description: "Get the user's top artists, tracks, or albums for a listening period.", strict: true, parameters: { type: "object", properties: { ...period, kind: { type: "string", enum: ["artists", "tracks", "albums"] } }, required: [...periodFields, "kind"], additionalProperties: false } },
  { type: "function", name: "get_listening_stats", description: "Get listening time, song count, artist count, and top artists for a listening period.", strict: true, parameters: { type: "object", properties: { ...period }, required: periodFields, additionalProperties: false } },
  { type: "function", name: "get_listening_sessions", description: "Get the user's longest listening sessions for a listening period.", strict: true, parameters: { type: "object", properties: { ...period }, required: periodFields, additionalProperties: false } },
  { type: "function", name: "query_plays", description: "Run a read-only MongoDB aggregation over the listener's plays in a period, for questions the other tools cannot answer, such as a specific artist, track, or album, time of day, weekday, first or last play, or counts by month. Each play document has: name (track title), artists (array of artist names), albumName (string or null, often missing), durationMs (number), playedAt (UTC date), trackId (string). At most 50 rows are returned, so aggregate or $limit.", strict: true, parameters: { type: "object", properties: { ...period, pipeline: { type: "string", description: `JSON array of aggregation stages. Allowed stages: ${QUERY_STAGES.join(", ")}. The period is already applied, so choose dates with range, startDate, and endDate instead of comparing playedAt to date literals. Match names case-insensitively with $regex and $options "i". Example: [{"$match":{"artists":"Paramore"}},{"$group":{"_id":"$name","plays":{"$sum":1}}},{"$sort":{"plays":-1}},{"$limit":10}]` } }, required: [...periodFields, "pipeline"], additionalProperties: false } },
];
// ChatGPT plan usage accepts function tools only when they are grouped in a namespace.
const planTools = [{ type: "namespace", name: "musistats", description: "Read-only lookups over the listener's MusiStats history.", tools }];
// Mapped from https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
const CHATGPT_ERRORS: Record<string, string> = { signin_required: "chatgpt_signin_required", http_401: "chatgpt_signin_required", invalid_api_key: "chatgpt_signin_required", subscription_sharing_invalid_user: "chatgpt_signin_required", subscription_sharing_usage_limit_exceeded: "chatgpt_usage_limit", subscription_sharing_user_not_eligible: "chatgpt_not_eligible" };

function isProvider(value: unknown): value is Provider { return typeof value === "string" && PROVIDERS.includes(value as Provider); }
function isLocalProvider(provider: Provider) { return provider === "ollama" || provider === "lmstudio"; }
function needsApiKey(provider: Provider) { return !isLocalProvider(provider) && provider !== "chatgpt"; }
function isLocalPort(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535; }
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
  return isProvider(provider) && typeof model === "string" && model.trim() && model.length <= 160 && (!needsApiKey(provider) || typeof encryptedApiKey === "string" && encryptedApiKey) && (!isLocalProvider(provider) || localPort === undefined || isLocalPort(localPort)) ? { provider, model, ...(typeof encryptedApiKey === "string" && encryptedApiKey ? { encryptedApiKey } : {}), ...(isLocalPort(localPort) ? { localPort } : {}) } : null;
}

async function userConfig(db: Db, userId: string): Promise<AssistantConfig | null> {
  if (!ObjectId.isValid(userId)) return null;
  return configFrom((await db.collection<UserWithAssistant>("Users").findOne({ _id: new ObjectId(userId) }))?.assistant);
}

function usesForbiddenOperator(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesForbiddenOperator);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_OPERATORS.includes(key) || usesForbiddenOperator(child));
}

// The model writes only the middle of the query. The server owns the collection, the leading $match on the signed-in
// user, and the trailing $limit, and no accepted stage can reach beyond the documents that $match lets through.
export function scopedPipeline(scope: Record<string, unknown>, rawPipeline: unknown): Record<string, unknown>[] | null {
  if (typeof rawPipeline !== "string" || rawPipeline.length > MAX_QUERY_LENGTH) return null;
  let stages: unknown;
  try { stages = JSON.parse(rawPipeline); } catch { return null; }
  if (!Array.isArray(stages)) return null;
  const allowed = stages.every((stage) => {
    const operators = Object.keys(asRecord(stage));
    return operators.length === 1 && QUERY_STAGES.includes(operators[0]) && !usesForbiddenOperator(stage);
  });
  return allowed ? [{ $match: scope }, ...stages, { $limit: MAX_QUERY_ROWS }] : null;
}

export async function runTool(db: Db, userId: string, name: string, rawArguments: string) {
  const args = parseObject(rawArguments);
  if (!isAnalyticsRange(args.range)) return { error: "invalid_tool_arguments" };
  const now = new Date();
  const bounds = rangeBounds(args.range, now, args.startDate, args.endDate);
  if (!bounds) return { error: "invalid_tool_arguments" };
  const range = args.range === CUSTOM_TIME_RANGE ? `${args.startDate} to ${args.endDate}` : args.range;
  const filter = bounds.start || bounds.end ? { userId, playedAt: { ...(bounds.start ? { $gte: bounds.start } : {}), ...(bounds.end ? { $lt: bounds.end } : {}) } } : { userId };
  if (name === "query_plays") {
    const pipeline = scopedPipeline(filter, args.pipeline);
    if (!pipeline) return { error: "pipeline_not_allowed", allowedStages: QUERY_STAGES };
    try {
      const rows = await db.collection("RecentPlays").aggregate(pipeline, { maxTimeMS: 5_000 }).toArray();
      return JSON.stringify(rows).length > MAX_QUERY_RESULT_LENGTH ? { error: "result_too_large", hint: "Aggregate, $project fewer fields, or use a smaller $limit." } : { range, rows };
    } catch (error) {
      // The database's message lets the model correct a malformed pipeline.
      return { error: "query_failed", message: error instanceof Error ? error.message.slice(0, 300) : "" };
    }
  }
  const plays = await db.collection<AssistantPlay>("RecentPlays").find(filter).sort({ playedAt: 1 }).toArray();
  if (name === "get_top_items") {
    if (args.kind !== "artists" && args.kind !== "tracks" && args.kind !== "albums") return { error: "invalid_tool_arguments" };
    return { range, items: historyTop(plays)[args.kind] };
  }
  if (name === "get_listening_stats") return { range, stats: buildStats(args.range, now, plays, plays[0]?.playedAt ?? null, bounds) };
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

// With `plan`, `apiKey` is a ChatGPT access token and the request runs on the user's ChatGPT plan, which rejects `max_output_tokens`.
async function answerOpenAICompatible(url: string, config: AssistantConfig, apiKey: string, db: Db, userId: string, messages: ChatMessage[], system: string, plan = false) {
  let input: unknown[] = messages.map((message) => ({ role: message.role, content: message.content }));
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = (plan
      ? await chatgptResponse(apiKey, { model: config.model, instructions: system, input, tools: planTools, parallel_tool_calls: false, include: ["reasoning.encrypted_content"] })
      : await request(url, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, { model: config.model, instructions: system, input, tools, parallel_tool_calls: false, max_output_tokens: 500, store: false })) as OpenAIResponse;
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

async function answerAnthropic(config: AssistantConfig, apiKey: string, db: Db, userId: string, messages: ChatMessage[], system: string) {
  let history: unknown[] = messages.map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = asRecord(await request("https://api.anthropic.com/v1/messages", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, { model: config.model, max_tokens: 500, system, messages: history, tools: anthropicTools() }));
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

async function answerGemini(config: AssistantConfig, apiKey: string, db: Db, userId: string, messages: ChatMessage[], system: string) {
  let contents: unknown[] = messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
  const geminiTools = [{ functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parameters: geminiSchema(parameters) })) }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = asRecord(await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, { "x-goog-api-key": apiKey }, { systemInstruction: { parts: [{ text: system }] }, contents, tools: geminiTools }));
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
  const system = instructions(await tasteFor(db, userId));
  if (config.provider === "anthropic") return answerAnthropic(config, apiKey, db, userId, messages, system);
  if (config.provider === "gemini") return answerGemini(config, apiKey, db, userId, messages, system);
  if (config.provider === "chatgpt") return answerOpenAICompatible("", config, await chatgptAccessToken(db, userId), db, userId, messages, system, true);
  const url = config.provider === "huggingface" ? "https://router.huggingface.co/v1/responses" : config.provider === "ollama" ? `http://127.0.0.1:${config.localPort ?? 11434}/v1/responses` : config.provider === "lmstudio" ? `http://127.0.0.1:${config.localPort ?? 1234}/v1/responses` : "https://api.openai.com/v1/responses";
  return answerOpenAICompatible(url, config, apiKey, db, userId, messages, system);
}

export function registerAssistantRoutes(app: Express, db: Db) {
  registerChatGPTRoutes(app, db);

  app.post("/api/assistant/settings", requireAuth, async (req, res) => {
    const { userId } = authPayload(req);
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: "unauthorized" });
    if (req.body?.remove === true) {
      await chatgptSignOut(db, userId);
      await db.collection("Users").updateOne({ _id: new ObjectId(userId) }, { $unset: { assistant: "" } });
      return res.json({ error: "", configured: false });
    }
    if (req.body?.provider === undefined) {
      const user = await db.collection<UserWithAssistant>("Users").findOne({ _id: new ObjectId(userId) });
      const config = configFrom(user?.assistant);
      return res.json({ error: "", configured: Boolean(config), chatgpt: chatgptStatus(user?.chatgpt), ...(config ? { provider: config.provider, model: config.model, ...(config.localPort ? { localPort: config.localPort } : {}) } : {}) });
    }
    const { provider, model, apiKey, localPort } = req.body ?? {};
    if (!isProvider(provider) || typeof model !== "string" || !model.trim() || model.length > 160 || isLocalProvider(provider) && localPort !== undefined && !isLocalPort(localPort) || needsApiKey(provider) && (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 500)) return res.status(400).json({ error: "invalid_request" });
    // ChatGPT is chosen by signing in; this route only changes its model. Choosing any other provider signs out of ChatGPT.
    if (provider === "chatgpt") {
      if (!chatgptStatus((await db.collection<UserWithAssistant>("Users").findOne({ _id: new ObjectId(userId) }))?.chatgpt).connected) return res.status(400).json({ error: "invalid_request" });
    } else await chatgptSignOut(db, userId);
    await db.collection("Users").updateOne({ _id: new ObjectId(userId) }, { $set: { assistant: { provider, model: model.trim(), ...(isLocalProvider(provider) && isLocalPort(localPort) ? { localPort } : {}), ...(needsApiKey(provider) ? { encryptedApiKey: encryptSecret(apiKey.trim()) } : {}), updatedAt: new Date() } } });
    return res.json({ error: "", configured: true, provider, model: model.trim(), ...(isLocalProvider(provider) && isLocalPort(localPort) ? { localPort } : {}) });
  });

  app.post("/api/assistant", requireAuth, async (req, res) => {
    const messages = parseChatMessages(req.body?.messages);
    if (!messages) return res.status(400).json({ error: "invalid_request" });
    const { userId } = authPayload(req);
    const config = await userConfig(db, userId);
    if (!config) return res.status(503).json({ error: "assistant_unavailable" });
    try { res.json({ error: "", reply: await answer(config, db, userId, messages) }); }
    catch (error) { console.error(`Assistant request failed for ${userId}:`, error); res.status(503).json({ error: error instanceof ChatGPTError && CHATGPT_ERRORS[error.code] || "assistant_unavailable" }); }
  });
}
