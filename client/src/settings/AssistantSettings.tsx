import { useEffect, useState, type FormEvent } from "react";
import type { ApiResponse } from "../auth/AuthProvider";

type Provider = "openai" | "chatgpt" | "anthropic" | "gemini" | "huggingface" | "ollama" | "lmstudio";
type ChatGPTStatus = { available: boolean; connected: boolean; email?: string };
type ChatGPTModel = { slug: string; name: string };
type SettingsResponse = ApiResponse & { configured?: boolean; provider?: Provider; model?: string; localPort?: number; chatgpt?: ChatGPTStatus };
const USAGE_URL = "https://chatgpt.com/settings/usage";
const providers: { value: Provider; label: string; example: string }[] = [
  { value: "openai", label: "OpenAI", example: "gpt-5-mini" },
  { value: "chatgpt", label: "ChatGPT account", example: "" },
  { value: "anthropic", label: "Claude", example: "claude-sonnet-4-5" },
  { value: "gemini", label: "Google Gemini", example: "gemini-2.5-flash" },
  { value: "huggingface", label: "Hugging Face", example: "openai/gpt-oss-120b:fastest" },
  { value: "ollama", label: "Ollama (local)", example: "qwen3" },
  { value: "lmstudio", label: "LM Studio (local)", example: "lmstudio-community/qwen2.5-7b-instruct" },
];
// Outcomes the ChatGPT sign-in callback reports as /?chatgpt=…
const signInErrors: Record<string, string> = {
  denied: "ChatGPT sign-in was cancelled.",
  plan_disabled: "ChatGPT plan usage wasn't enabled for MusiStats, so the assistant can't use your plan. Continue with ChatGPT again to enable it.",
  failed: "ChatGPT sign-in could not be completed. Please try again.",
};
const field = "rounded-xl border border-border-app bg-surface-raised px-3 py-2.5 text-sm font-normal text-fg placeholder:text-muted focus:border-accent focus:outline-none";
function isSettings(value: ApiResponse): value is SettingsResponse { return value.error === "" && typeof value.configured === "boolean"; }

export default function AssistantSettings({ authedPost }: { authedPost: (url: string, body?: unknown) => Promise<ApiResponse> }) {
  const [signIn] = useState(() => new URLSearchParams(window.location.search).get("chatgpt") ?? "");
  const [welcome, setWelcome] = useState(signIn === "connected");
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState("gpt-5-mini");
  const [apiKey, setApiKey] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [configured, setConfigured] = useState(false);
  const [chatgpt, setChatgpt] = useState<ChatGPTStatus>({ available: false, connected: false });
  const [chatgptModels, setChatgptModels] = useState<ChatGPTModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(signInErrors[signIn] ?? "");
  // The form values as last saved, so the confirmation disappears as soon as any of them is edited.
  const [saved, setSaved] = useState("");
  const choice = providers.find((item) => item.value === provider)!;
  const local = provider === "ollama" || provider === "lmstudio";
  const plan = provider === "chatgpt";
  const needsKey = !local && !plan;
  const isSaved = !saving && saved === [provider, model, localPort, apiKey].join("\n");
  const modelOptions = chatgptModels.some((item) => item.slug === model) || !model ? chatgptModels : [{ slug: model, name: model }, ...chatgptModels];
  useEffect(() => {
    if (signIn) window.history.replaceState({}, "", window.location.pathname);
  }, [signIn]);
  useEffect(() => {
    let active = true;
    void authedPost("/api/assistant/settings").then((response) => {
      if (!active) return;
      if (isSettings(response)) { setConfigured(response.configured === true); if (response.provider) setProvider(response.provider); if (response.model) setModel(response.model); if (typeof response.localPort === "number") setLocalPort(String(response.localPort)); if (response.chatgpt) setChatgpt(response.chatgpt); }
      else setError("Your assistant settings could not be loaded.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [authedPost]);
  useEffect(() => {
    if (!chatgpt.connected) return;
    let active = true;
    void authedPost("/api/assistant/chatgpt/models").then((response) => {
      if (active && response.error === "" && Array.isArray(response.models)) setChatgptModels(response.models as ChatGPTModel[]);
    });
    return () => { active = false; };
  }, [authedPost, chatgpt.connected]);
  function selectProvider(next: Provider) { setProvider(next); setModel(next === "chatgpt" ? chatgptModels[0]?.slug ?? "" : providers.find((item) => item.value === next)!.example); setLocalPort(""); }
  async function continueWithChatGPT() {
    setSaving(true); setError("");
    const response = await authedPost("/api/assistant/chatgpt/start");
    if (response.error === "" && typeof response.url === "string") return window.location.assign(response.url);
    setSaving(false); setError("ChatGPT sign-in could not be started.");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const port = Number(localPort);
    const response = await authedPost("/api/assistant/settings", { provider, model, ...(local ? { ...(localPort ? { localPort: port } : {}) } : needsKey ? { apiKey } : {}) });
    setSaving(false);
    if (!isSettings(response) || !response.configured) return setError(plan ? "Your model could not be saved." : "Your provider settings could not be saved. Check the model and API key.");
    setConfigured(true); setApiKey(""); setSaved([provider, model, localPort, ""].join("\n"));
    // Saving any other provider signs out of ChatGPT on the server.
    if (!plan) setChatgpt((status) => ({ ...status, connected: false }));
  }
  async function remove() {
    setSaving(true); setError("");
    const response = await authedPost("/api/assistant/settings", { remove: true });
    setSaving(false);
    if (!isSettings(response) || response.configured) return setError("Your provider settings could not be removed.");
    setConfigured(false); setApiKey(""); setSaved(""); setChatgpt((status) => ({ ...status, connected: false }));
  }
  return <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6">
    <h2 className="text-lg font-semibold text-fg">Listening assistant</h2>
    <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Choose the AI provider you want MusiStats to use. Your API key is encrypted before storage and is never shown again. It is sent only to the provider you choose when you ask a question.</p>
    {local && <p className="mt-4 rounded-xl bg-surface-raised px-4 py-3 text-sm text-muted">MusiStats will connect to {provider === "ollama" ? "Ollama" : "LM Studio"} on 127.0.0.1 from the server. Start the local API on the same machine as MusiStats.</p>}
    {plan && chatgpt.connected ? <p className="mt-4 rounded-xl bg-accent/10 px-4 py-3 text-sm text-accent">Using ChatGPT plan{chatgpt.email ? ` as ${chatgpt.email}` : ""} · <a href={USAGE_URL} target="_blank" rel="noreferrer" className="font-semibold underline">Manage usage</a></p>
      : configured && !plan && <p className="mt-4 rounded-xl bg-accent/10 px-4 py-3 text-sm text-accent">A provider is configured. {local ? "Choose a model or port to replace it." : "Enter a new key to change it."}</p>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</p>}
    {loading ? <div className="mt-5 h-40 animate-pulse rounded-xl bg-surface-raised" /> : <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-semibold text-fg">Provider<select value={provider} onChange={(event) => selectProvider(event.target.value as Provider)} disabled={saving} className={field}>{providers.filter((item) => item.value !== "chatgpt" || chatgpt.available || chatgpt.connected || plan).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      {plan && !chatgpt.connected ? <div className="rounded-xl bg-surface-raised px-4 py-4 sm:col-span-2">
        <h3 className="text-sm font-semibold text-fg">Use your ChatGPT plan</h3>
        <p className="mt-1 text-sm leading-6 text-muted">Answer assistant questions in MusiStats with usage included in your ChatGPT plan or credits balance. No API key is needed.</p>
        <button type="button" onClick={() => void continueWithChatGPT()} disabled={saving || !chatgpt.available} className="mt-4 rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">Continue with ChatGPT</button>
        {!chatgpt.available && <p className="mt-3 text-xs text-muted">ChatGPT sign-in is only available when MusiStats runs on this computer.</p>}
      </div> : plan ? <label className="grid gap-2 text-sm font-semibold text-fg">Model<select value={model} onChange={(event) => setModel(event.target.value)} disabled={saving} className={field}>{modelOptions.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
        : <label className="grid gap-2 text-sm font-semibold text-fg">Model<input value={model} onChange={(event) => setModel(event.target.value)} disabled={saving} maxLength={160} placeholder={choice.example} className={field} /></label>}
      {local && <label className="grid gap-2 text-sm font-semibold text-fg">Port<input type="number" value={localPort} onChange={(event) => setLocalPort(event.target.value)} disabled={saving} min="1" max="65535" placeholder={provider === "ollama" ? "11434" : "1234"} className={field} /></label>}
      {needsKey && <label className="grid gap-2 text-sm font-semibold text-fg sm:col-span-2">API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={saving} maxLength={500} required placeholder={`Your ${choice.label} API key`} autoComplete="off" className={field} /></label>}
      <div className="flex items-center gap-3 sm:col-span-2">
        {(!plan || chatgpt.connected) && <button type="submit" disabled={saving || isSaved || !model.trim() || needsKey && !apiKey.trim()} className={`rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-accent-fg transition enabled:hover:brightness-110 ${isSaved ? "" : "disabled:cursor-not-allowed disabled:opacity-50"}`}>{saving ? "Saving…" : isSaved ? "Saved" : plan ? "Save model" : configured ? "Replace provider" : "Save provider"}</button>}
        {configured && <button type="button" onClick={() => void remove()} disabled={saving} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-error transition hover:bg-error/10 disabled:opacity-50">{chatgpt.connected ? "Sign out of ChatGPT" : "Remove provider"}</button>}
        <p role="status" className="sr-only">{isSaved && `Saved. The assistant now uses ${model}.`}</p>
      </div>
    </form>}
    {welcome && <div role="dialog" aria-modal="true" aria-labelledby="chatgpt-welcome" className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-5"><div className="w-full max-w-sm rounded-2xl border border-border-app bg-surface p-6 text-center shadow-2xl shadow-black/50">
      <h3 id="chatgpt-welcome" className="text-lg font-semibold text-fg">You're using your ChatGPT plan</h3>
      <p className="mt-2 text-sm leading-6 text-muted">Eligible assistant requests in MusiStats now use your ChatGPT plan. You can review and manage usage in <a href={USAGE_URL} target="_blank" rel="noreferrer" className="font-semibold text-fg underline">ChatGPT settings</a>.</p>
      <button type="button" autoFocus onClick={() => setWelcome(false)} className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-accent-fg transition hover:brightness-110">Got it</button>
    </div></div>}
  </section>;
}
