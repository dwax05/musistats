import { useState, type FormEvent } from "react";
import type { ApiResponse } from "../auth/AuthProvider";

type Message = { role: "user" | "assistant"; content: string };
type AssistantResponse = ApiResponse & { reply?: string };
const suggestions = ["Who did I listen to most this month?", "How has my listening changed over the last 6 months?", "What were my longest listening sessions?"];

function isAssistantResponse(value: ApiResponse): value is AssistantResponse & { error: ""; reply: string } {
  return value.error === "" && typeof value.reply === "string" && Boolean(value.reply.trim());
}

export default function AssistantPanel({ authedPost, demo }: { authedPost: (url: string, body?: unknown) => Promise<ApiResponse>; demo: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  async function send(content: string) {
    const question = content.trim();
    if (!question || sending || demo) return;
    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next); setDraft(""); setError(""); setSending(true);
    const response = await authedPost("/api/assistant", { messages: next });
    setSending(false);
    if (isAssistantResponse(response)) return setMessages([...next, { role: "assistant", content: response.reply }]);
    setError(response.error === "assistant_unavailable" ? "The listening assistant is not configured right now." : "I couldn't answer that. Please try again.");
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(draft); }
  return <section className="mx-auto max-w-3xl rounded-2xl border border-border-app/80 bg-surface/95 shadow-xl shadow-black/20"><div className="border-b border-border-app px-5 py-5 sm:px-6"><h2 className="text-lg font-semibold text-fg">Ask about your listening</h2><p className="mt-1 text-sm text-muted">Answers use your imported listening history. Playlist creation is not available yet.</p></div><div className="min-h-80 space-y-4 px-5 py-5 sm:px-6" aria-live="polite">{demo ? <p className="text-sm text-muted">Connect Spotify to use the listening assistant.</p> : messages.length ? messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm text-accent-fg" : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-raised px-4 py-3 text-sm leading-6 text-fg"}>{message.content}</div>) : <div><p className="text-sm text-muted">Try one of these questions:</p><div className="mt-4 flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void send(suggestion)} className="rounded-xl border border-border-app px-3 py-2 text-left text-sm text-fg transition hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">{suggestion}</button>)}</div></div>}{sending && <div className="mr-auto w-fit rounded-2xl rounded-bl-sm bg-surface-raised px-4 py-3 text-sm text-muted">Looking at your listening data…</div>}{error && <p role="alert" className="text-sm text-error">{error}</p>}</div><form onSubmit={submit} className="flex gap-3 border-t border-border-app p-4 sm:p-5"><label className="sr-only" htmlFor="assistant-question">Ask a question about your listening</label><textarea id="assistant-question" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={sending || demo} maxLength={1_000} rows={2} placeholder="Ask about your listening…" className="min-h-12 flex-1 resize-none rounded-xl border border-border-app bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" /><button type="submit" disabled={!draft.trim() || sending || demo} className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40">Send</button></form></section>;
}
