import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ApiResponse } from "../auth/AuthProvider";

type Message = { role: "user" | "assistant"; content: string };
type AssistantResponse = ApiResponse & { reply?: string };
const USAGE_URL = "https://chatgpt.com/settings/usage";
const errors: Record<string, string> = {
  assistant_unavailable: "The listening assistant is not configured right now.",
  chatgpt_usage_limit: "Usage limit reached. Review your ChatGPT plan or the MusiStats limit in ChatGPT settings.",
  chatgpt_signin_required: "Your ChatGPT sign-in has ended. Continue with ChatGPT again in Settings.",
  chatgpt_not_eligible: "ChatGPT plan usage isn't available for this ChatGPT account. Choose another provider in Settings.",
};
const suggestions = ["Who did I listen to most this month?", "How has my listening changed over the last 6 months?", "What were my longest listening sessions?"];

function isAssistantResponse(value: ApiResponse): value is AssistantResponse & { error: ""; reply: string } {
  return value.error === "" && typeof value.reply === "string" && Boolean(value.reply.trim());
}

export default function AssistantPanel({ authedPost, demo }: { authedPost: (url: string, body?: unknown) => Promise<ApiResponse>; demo: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [usingPlan, setUsingPlan] = useState(false);
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [messages, sending, open]);
  useEffect(() => {
    if (demo) return;
    let active = true;
    void authedPost("/api/assistant/settings").then((response) => { if (active) setUsingPlan(response.provider === "chatgpt"); });
    return () => { active = false; };
  }, [authedPost, demo]);
  async function send(content: string) {
    const question = content.trim();
    if (!question || sending || demo) return;
    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next); setDraft(""); setError(""); setSending(true);
    const response = await authedPost("/api/assistant", { messages: next });
    setSending(false);
    if (isAssistantResponse(response)) return setMessages([...next, { role: "assistant", content: response.reply }]);
    setError(errors[response.error] ?? "I couldn't answer that. Please try again.");
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(draft); }
  return <div onKeyDown={(event) => { if (open && event.key === "Escape") { setOpen(false); launcher.current?.focus(); } }} className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
    <AnimatePresence>{open && <motion.section id="assistant-window" aria-label="Ask MusiStats" initial={{ opacity: 0, scale: 0.2 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.2 }} transition={{ duration: 0.2, ease: "easeOut" }} className="pointer-events-auto flex h-[min(34rem,calc(100dvh-6.5rem))] w-[min(24rem,calc(100vw-2rem))] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-border-app bg-surface shadow-2xl shadow-black/50"><div className="border-b border-border-app px-4 py-3"><h2 className="text-sm font-semibold text-fg">Ask MusiStats</h2><p className="mt-0.5 text-xs text-muted">Answers use your imported listening history. Playlist creation is not available yet.</p></div><div ref={list} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">{demo ? <p className="text-sm text-muted">Connect Spotify to use the listening assistant.</p> : messages.length ? messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm text-accent-fg" : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-raised px-4 py-3 text-sm leading-6 text-fg"}>{message.content}</div>) : <div><p className="text-sm text-muted">Try one of these questions:</p><div className="mt-4 flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void send(suggestion)} className="rounded-xl border border-border-app px-3 py-2 text-left text-sm text-fg transition hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">{suggestion}</button>)}</div></div>}{sending && <div className="mr-auto w-fit rounded-2xl rounded-bl-sm bg-surface-raised px-4 py-3 text-sm text-muted">Looking at your listening data…</div>}{error && <p role="alert" className="text-sm text-error">{error}{error === errors.chatgpt_usage_limit && <> <a href={USAGE_URL} target="_blank" rel="noreferrer" className="font-semibold underline">Manage usage</a></>}</p>}</div>{usingPlan && <p className="border-t border-border-app px-4 pt-3 text-xs text-muted">Using ChatGPT plan · <a href={USAGE_URL} target="_blank" rel="noreferrer" className="font-semibold text-fg underline">Manage usage</a></p>}<form onSubmit={submit} className={`flex gap-2 p-3 ${usingPlan ? "" : "border-t border-border-app"}`}><label className="sr-only" htmlFor="assistant-question">Ask a question about your listening</label><textarea id="assistant-question" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={sending || demo} maxLength={1_000} rows={2} autoFocus placeholder="Ask about your listening…" className="min-h-12 flex-1 resize-none rounded-xl border border-border-app bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" /><button type="submit" disabled={!draft.trim() || sending || demo} className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40">Send</button></form></motion.section>}</AnimatePresence>
    <button ref={launcher} type="button" aria-label={open ? "Minimize Ask MusiStats" : "Ask MusiStats"} aria-expanded={open} aria-controls="assistant-window" onClick={() => setOpen((current) => !current)} className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-fg shadow-xl shadow-black/40 transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"><svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{open ? <path d="m6 9 6 6 6-6" /> : <><path d="M12 4v3M2 12v3M22 12v3M9.5 15.5h5" /><circle cx="12" cy="3" r="1" /><rect x="4" y="7" width="16" height="12" rx="3" /><circle cx="9" cy="11.5" r="1" fill="currentColor" /><circle cx="15" cy="11.5" r="1" fill="currentColor" /></>}</svg></button>
  </div>;
}
