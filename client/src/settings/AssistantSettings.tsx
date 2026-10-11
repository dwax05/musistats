import { useEffect, useState, type FormEvent } from "react";
import type { ApiResponse } from "../auth/AuthProvider";

type Provider = "openai" | "anthropic" | "gemini" | "huggingface" | "ollama" | "lmstudio";
type SettingsResponse = ApiResponse & { configured?: boolean; provider?: Provider; model?: string; localPort?: number };
const providers: { value: Provider; label: string; example: string }[] = [
  { value: "openai", label: "OpenAI", example: "gpt-5-mini" },
  { value: "anthropic", label: "Claude", example: "claude-sonnet-4-5" },
  { value: "gemini", label: "Google Gemini", example: "gemini-2.5-flash" },
  { value: "huggingface", label: "Hugging Face", example: "openai/gpt-oss-120b:fastest" },
  { value: "ollama", label: "Ollama (local)", example: "qwen3" },
  { value: "lmstudio", label: "LM Studio (local)", example: "lmstudio-community/qwen2.5-7b-instruct" },
];
function isSettings(value: ApiResponse): value is SettingsResponse { return value.error === "" && typeof value.configured === "boolean"; }

export default function AssistantSettings({ authedPost }: { authedPost: (url: string, body?: unknown) => Promise<ApiResponse> }) {
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState("gpt-5-mini");
  const [apiKey, setApiKey] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const choice = providers.find((item) => item.value === provider)!;
  const local = provider === "ollama" || provider === "lmstudio";
  useEffect(() => {
    let active = true;
    void authedPost("/api/assistant/settings").then((response) => {
      if (!active) return;
      if (isSettings(response)) { setConfigured(response.configured === true); if (response.provider) setProvider(response.provider); if (response.model) setModel(response.model); if (typeof response.localPort === "number") setLocalPort(String(response.localPort)); }
      else setError("Your assistant settings could not be loaded.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [authedPost]);
  function selectProvider(next: Provider) { setProvider(next); setModel(providers.find((item) => item.value === next)!.example); setLocalPort(""); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const port = Number(localPort);
    const response = await authedPost("/api/assistant/settings", { provider, model, ...(local ? { ...(localPort ? { localPort: port } : {}) } : { apiKey }) });
    setSaving(false);
    if (!isSettings(response) || !response.configured) return setError("Your provider settings could not be saved. Check the model and API key.");
    setConfigured(true); setApiKey("");
  }
  async function remove() {
    setSaving(true); setError("");
    const response = await authedPost("/api/assistant/settings", { remove: true });
    setSaving(false);
    if (!isSettings(response) || response.configured) return setError("Your provider settings could not be removed.");
    setConfigured(false); setApiKey("");
  }
  return <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6"><h2 className="text-lg font-semibold text-fg">Listening assistant</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted">Choose the AI provider you want MusiStats to use. Your API key is encrypted before storage and is never shown again. It is sent only to the provider you choose when you ask a question.</p>{local && <p className="mt-4 rounded-xl bg-surface-raised px-4 py-3 text-sm text-muted">MusiStats will connect to {provider === "ollama" ? "Ollama" : "LM Studio"} on 127.0.0.1 from the server. Start the local API on the same machine as MusiStats.</p>}{configured && <p className="mt-4 rounded-xl bg-accent/10 px-4 py-3 text-sm text-accent">A provider is configured. {local ? "Choose a model or port to replace it." : "Enter a new key to change it."}</p>}{error && <p role="alert" className="mt-4 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</p>}{loading ? <div className="mt-5 h-40 animate-pulse rounded-xl bg-surface-raised" /> : <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold text-fg">Provider<select value={provider} onChange={(event) => selectProvider(event.target.value as Provider)} disabled={saving} className="rounded-xl border border-border-app bg-surface-raised px-3 py-2.5 text-sm font-normal text-fg focus:border-accent focus:outline-none">{providers.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="grid gap-2 text-sm font-semibold text-fg">Model<input value={model} onChange={(event) => setModel(event.target.value)} disabled={saving} maxLength={160} placeholder={choice.example} className="rounded-xl border border-border-app bg-surface-raised px-3 py-2.5 text-sm font-normal text-fg placeholder:text-muted focus:border-accent focus:outline-none" /></label>{local && <label className="grid gap-2 text-sm font-semibold text-fg">Port<input type="number" value={localPort} onChange={(event) => setLocalPort(event.target.value)} disabled={saving} min="1" max="65535" placeholder={provider === "ollama" ? "11434" : "1234"} className="rounded-xl border border-border-app bg-surface-raised px-3 py-2.5 text-sm font-normal text-fg placeholder:text-muted focus:border-accent focus:outline-none" /></label>}{!local && <label className="grid gap-2 text-sm font-semibold text-fg sm:col-span-2">API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={saving} maxLength={500} required placeholder={`Your ${choice.label} API key`} autoComplete="off" className="rounded-xl border border-border-app bg-surface-raised px-3 py-2.5 text-sm font-normal text-fg placeholder:text-muted focus:border-accent focus:outline-none" /></label>}<div className="flex items-center gap-3 sm:col-span-2"><button type="submit" disabled={saving || !model.trim() || !local && !apiKey.trim()} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-accent-fg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : configured ? "Replace provider" : "Save provider"}</button>{configured && <button type="button" onClick={() => void remove()} disabled={saving} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-error transition hover:bg-error/10 disabled:opacity-50">Remove provider</button>}</div></form>}</section>;
}
