import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ApiResponse } from "../auth/AuthProvider";
import { DEFAULT_THEME_ID, THEME_PRESETS, type ThemeId } from "../ui/themePresets";
import { useTheme } from "../ui/ThemeProvider";
import { computedThemeVariables, entriesFromVariables, isThemeSlots, parseThemeCss, readableOn, serializeThemeCss, THEME_VARIABLE_GROUPS, type ThemeEntry, type ThemeSlots, type ThemeVariable, type ThemeVariables } from "./themeCss";

type ThemeEditorProps = {
  authedPost: (url: string, body?: unknown) => Promise<ApiResponse>;
  demo?: boolean;
};

const LOCAL_SLOTS_KEY = "musistats-theme-slots:v1";

function readLocalSlots(): ThemeSlots {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOCAL_SLOTS_KEY) ?? "null");
    return isThemeSlots(value) ? value : [null, null, null];
  } catch {
    return [null, null, null];
  }
}

function variablesFromEntries(entries: ThemeEntry[]): ThemeVariables {
  return Object.fromEntries(entries.map(({ key, value }) => [key, value])) as ThemeVariables;
}

const LABELS: Record<ThemeVariable, string> = { "--bg": "Background", "--fg": "Text", "--surface": "Surface", "--surface-raised": "Raised surface", "--border": "Border", "--muted": "Muted text", "--accent": "Accent", "--accent-fg": "Accent text", "--error": "Error" };
const card = "rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6";
const slotAction = "relative -m-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg opacity-70 transition hover:opacity-100 focus-visible:outline-2 focus-visible:outline-accent";
// As many 6.5rem-or-wider columns as fit, capped at three by the 30% floor.
const cardGrid = "mt-3 grid grid-cols-[repeat(auto-fill,minmax(max(6.5rem,30%),1fr))] gap-3";
const outlineButton = "rounded-lg border border-border-app px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent";
// Cards set their own palette variables (data-theme or inline), so these resolve per card.
const dots = <span aria-hidden="true" className="flex min-w-0 justify-end gap-1"><span className="h-2.5 w-4 rounded-full bg-(--accent)" /><span className="h-2.5 w-4 rounded-full bg-(--error)" /><span className="h-2.5 w-4 rounded-full bg-(--muted)" /><span className="h-2.5 w-4 rounded-full bg-(--fg)" /></span>;

export default function ThemeEditor({ authedPost, demo = false }: ThemeEditorProps) {
  const { theme, setTheme, customCss, applyThemeCss } = useTheme();
  const initialTheme = useRef(theme);
  const initialVariables = customCss ? parseThemeCss(customCss) : null;
  const [entries, setEntries] = useState(() => entriesFromVariables(initialVariables ?? computedThemeVariables()));
  const savedCss = useRef<string | null>(null);
  const unsaved = useRef(false);
  const [slots, setSlots] = useState<ThemeSlots>(readLocalSlots);
  const [draftValues, setDraftValues] = useState<Partial<Record<ThemeVariable, string>>>({});
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [status, setStatus] = useState("");
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (demo || initialLoadDone.current) return;
    let active = true;
    initialLoadDone.current = true;
    void authedPost("/api/theme/get").then((response) => {
      if (!active) return;
      if (response.error || !isThemeSlots(response.slots)) {
        setStatus("Saved themes could not be loaded. You can still preview palettes locally.");
        return;
      }
      setSlots(response.slots);
      try { localStorage.setItem(LOCAL_SLOTS_KEY, JSON.stringify(response.slots)); } catch { /* Keep slots in memory. */ }
      if (typeof response.css === "string" && response.css) {
        const parsed = parseThemeCss(response.css);
        if (parsed) {
          const css = serializeThemeCss(entriesFromVariables(parsed));
          savedCss.current = css;
          setEntries(entriesFromVariables(parsed));
          applyThemeCss(css);
        }
      }
    }).catch((error: unknown) => {
      if (!active) return;
      console.error("Saved themes could not be loaded.", error);
      setStatus("Saved themes could not be loaded. You can still preview palettes locally.");
    });
    return () => { active = false; };
  }, [applyThemeCss, authedPost, demo]);

  // Leaving the editor by any route drops changes that were never saved.
  useEffect(() => () => {
    if (!unsaved.current) return;
    if (savedCss.current) applyThemeCss(savedCss.current);
    else setTheme(initialTheme.current);
  }, [applyThemeCss, setTheme]);

  function updateEntry(key: ThemeVariable, value: string) {
    unsaved.current = true;
    const next = entries.map((entry) => entry.key === key ? { ...entry, value } : entry);
    setEntries(next);
    applyThemeCss(serializeThemeCss(next));
  }

  function selectPreset(id: ThemeId) {
    unsaved.current = true;
    setTheme(id);
    const next = entriesFromVariables(computedThemeVariables());
    setEntries(next);
    setDraftValues({});
    setStatus(`${THEME_PRESETS.find((preset) => preset.id === id)?.name ?? "Theme"} preview`);
  }

  function resetTheme() {
    unsaved.current = true;
    setTheme(DEFAULT_THEME_ID);
    const next = entriesFromVariables(computedThemeVariables());
    setEntries(next);
    setDraftValues({});
    setStatus("Reset to UCF Knights");
  }

  async function saveTheme() {
    const css = serializeThemeCss(entries);
    setBusy(true);
    setStatus("");
    setSaveFlash(true);
    window.setTimeout(() => setSaveFlash(false), 250);
    if (demo) {
      savedCss.current = css;
      unsaved.current = false;
      setBusy(false);
      setStatus("Saved for this demo on this device.");
      return;
    }
    try {
      const response = await authedPost("/api/theme/save", { css });
      if (response.error || response.saved !== true || typeof response.css !== "string") {
        setStatus(response.error === "offline" ? "MusiStats is temporarily unavailable." : "Theme could not be saved.");
      } else {
        const canonical = parseThemeCss(response.css);
        if (canonical) {
          const saved = serializeThemeCss(entriesFromVariables(canonical));
          savedCss.current = saved;
          unsaved.current = false;
          applyThemeCss(saved);
          setStatus("Theme saved.");
        }
      }
    } catch (error) {
      console.error("Theme save failed.", error);
      setStatus("Theme could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function updateSlots(next: ThemeSlots) {
    setSlots(next);
    try { localStorage.setItem(LOCAL_SLOTS_KEY, JSON.stringify(next)); } catch { /* Keep slots in memory. */ }
    if (demo) {
      setStatus("Theme slot saved on this device.");
      return;
    }
    try {
      const response = await authedPost("/api/theme/slots", { slots: next });
      if (response.error || !isThemeSlots(response.slots)) setStatus("Theme slots could not be synced.");
      else {
        setSlots(response.slots);
        setStatus("Theme slots synced.");
      }
    } catch (error) {
      console.error("Theme slots update failed.", error);
      setStatus("Theme slots could not be synced.");
    }
  }

  function saveSlot(index: number) {
    const next = [...slots] as ThemeSlots;
    next[index] = variablesFromEntries(entries);
    void updateSlots(next);
  }

  function clearSlot(index: number) {
    const next = [...slots] as ThemeSlots;
    next[index] = null;
    void updateSlots(next);
  }

  function loadSlot(slot: ThemeVariables) {
    const next = entriesFromVariables(slot);
    const css = serializeThemeCss(next);
    unsaved.current = true;
    setEntries(next);
    setDraftValues({});
    applyThemeCss(css, true);
    setStatus("Saved theme preview");
  }

  async function exportTheme() {
    try {
      await navigator.clipboard.writeText(serializeThemeCss(entries));
      setStatus("Theme CSS copied to clipboard.");
    } catch {
      setImportText(serializeThemeCss(entries));
      setImportOpen(true);
      setStatus("Copy is unavailable. Theme CSS is shown below for export.");
    }
  }

  function importTheme() {
    const parsed = parseThemeCss(importText);
    if (!parsed) {
      setStatus("Import needs valid hex color declarations for supported theme variables.");
      return;
    }
    const next = entriesFromVariables(parsed);
    unsaved.current = true;
    setEntries(next);
    setDraftValues({});
    applyThemeCss(serializeThemeCss(next), true);
    setImportOpen(false);
    setStatus("Imported theme preview");
  }

  return <div className="space-y-6">
    <div className="grid items-start gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
      <section className={`${card} space-y-8`}>{THEME_VARIABLE_GROUPS.map((group) => <fieldset key={group.label} className="min-w-0 space-y-3"><legend className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">{group.label}</legend>{group.variables.map((key) => {
        const entry = entries.find((item) => item.key === key)!;
        return <div key={key} className="grid grid-cols-[6.5rem_2.25rem_6rem] items-center gap-3"><span className="truncate text-sm text-muted">{LABELS[key]}</span><input aria-label={`${LABELS[key]} color picker`} type="color" value={entry.value} onChange={(event) => { setDraftValues((current) => ({ ...current, [key]: event.target.value })); updateEntry(key, event.target.value); }} className="h-9 w-9 cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0" /><input aria-label={`${LABELS[key]} hex color`} value={draftValues[key] ?? entry.value} onChange={(event) => { const value = event.target.value; setDraftValues((current) => ({ ...current, [key]: value })); if (/^#[\da-f]{6}$/i.test(value)) updateEntry(key, value.toLowerCase()); }} spellCheck={false} style={{ backgroundColor: entry.value, color: readableOn(entry.value) }} className="min-h-9 w-full rounded-lg px-3 font-mono text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent" /></div>;
      })}</fieldset>)}</section>

      <aside className={`${card} space-y-6`}>
        <section><h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Presets</h3><div className={cardGrid}>{THEME_PRESETS.map((preset) => <button key={preset.id} type="button" data-theme={preset.id} aria-pressed={theme === preset.id && !customCss} onClick={() => selectPreset(preset.id)} className={`flex h-24 min-w-0 flex-col justify-between gap-4 rounded-xl border bg-(--bg) p-3 text-left text-sm font-semibold text-(--fg) transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent ${theme === preset.id && !customCss ? "border-(--accent) ring-2 ring-(--accent)" : "border-transparent"}`}>{dots}<span>{preset.name}</span></button>)}</div></section>

        <section><h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Saved</h3><div className={cardGrid}>{slots.map((slot, index) => <div key={index} style={slot ? slot as CSSProperties : undefined} className={`relative flex h-24 min-w-0 flex-col justify-between gap-4 rounded-xl border border-(--border) bg-(--bg) p-3 text-sm font-semibold ${slot ? "text-(--fg)" : "text-muted"}`}>{slot && <button type="button" aria-label={`Load slot ${index + 1}`} onClick={() => loadSlot(slot)} className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-accent" />}<span className="flex items-center justify-between gap-1">{slot ? <button type="button" aria-label={`Clear slot ${index + 1}`} title="Clear slot" onClick={() => clearSlot(index)} className={slotAction}>×</button> : <span />}{slot && dots}</span><span className="flex items-center justify-between gap-1"><span className="truncate">Slot {index + 1}</span><button type="button" aria-label={`Save current theme to slot ${index + 1}`} title="Save current colors here" onClick={() => saveSlot(index)} className={slotAction}>↓</button></span></div>)}</div></section>
      </aside>
    </div>

    <footer className="flex flex-wrap items-center gap-2 border-t border-border-app pt-5"><button type="button" onClick={() => void saveTheme()} disabled={busy} style={saveFlash ? { background: "var(--success, var(--accent))" } : undefined} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-fg transition-all duration-100 hover:brightness-110 disabled:cursor-wait disabled:opacity-60">{busy ? "Saving…" : "Save"}</button><button type="button" onClick={resetTheme} className={outlineButton}>Reset</button><p role="status" aria-live="polite" className="min-h-5 flex-1 basis-40 px-2 text-sm text-muted">{status}</p><button type="button" onClick={() => void exportTheme()} className={outlineButton}>Export</button><button type="button" aria-expanded={importOpen} onClick={() => setImportOpen((open) => !open)} className={outlineButton}>Import</button></footer>

    {importOpen && <div className="space-y-3"><label className="grid gap-1 text-xs font-medium text-muted">Theme CSS<textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={7} spellCheck={false} className="w-full rounded-lg border border-border-app bg-surface p-3 font-mono text-xs text-fg focus-visible:outline-2 focus-visible:outline-accent" /></label><button type="button" onClick={importTheme} className={outlineButton}>Apply imported CSS</button></div>}
  </div>;
}
