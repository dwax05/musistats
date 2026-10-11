import { useEffect, useRef, useState } from "react";
import type { ApiResponse } from "../auth/AuthProvider";
import { DEFAULT_THEME_ID, THEME_GROUPS, THEME_PRESETS, THEME_SWATCHES, type ThemeId } from "../ui/themePresets";
import { useTheme } from "../ui/ThemeProvider";
import { computedThemeVariables, entriesFromVariables, isThemeSlots, parseThemeCss, serializeThemeCss, THEME_VARIABLE_GROUPS, type ThemeEntry, type ThemeSlots, type ThemeVariable, type ThemeVariables } from "./themeCss";

type ThemeEditorProps = {
  authedPost: (url: string, body?: unknown) => Promise<ApiResponse>;
  onClose: () => void;
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

function labelFor(key: ThemeVariable) {
  return key.replace(/^--/, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ThemeEditor({ authedPost, onClose, demo = false }: ThemeEditorProps) {
  const { theme, setTheme, customCss, applyThemeCss } = useTheme();
  const initialTheme = useRef(theme);
  const initialVariables = customCss ? parseThemeCss(customCss) : null;
  const [entries, setEntries] = useState(() => entriesFromVariables(initialVariables ?? computedThemeVariables()));
  const [savedCss, setSavedCss] = useState<string | null>(null);
  const [slots, setSlots] = useState<ThemeSlots>(readLocalSlots);
  const [draftValues, setDraftValues] = useState<Partial<Record<ThemeVariable, string>>>({});
  const [importText, setImportText] = useState("");
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
          setSavedCss(css);
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

  function updateEntry(key: ThemeVariable, value: string) {
    const next = entries.map((entry) => entry.key === key ? { ...entry, value } : entry);
    setEntries(next);
    applyThemeCss(serializeThemeCss(next));
  }

  function selectPreset(id: ThemeId) {
    setTheme(id);
    const next = entriesFromVariables(computedThemeVariables());
    setEntries(next);
    setDraftValues({});
    setStatus(`${THEME_PRESETS.find((preset) => preset.id === id)?.name ?? "Theme"} preview`);
  }

  function resetTheme() {
    setTheme(DEFAULT_THEME_ID);
    const next = entriesFromVariables(computedThemeVariables());
    setEntries(next);
    setDraftValues({});
    setStatus("Reset to UCF Knights");
  }

  function closeEditor() {
    if (savedCss) applyThemeCss(savedCss);
    else setTheme(initialTheme.current);
    onClose();
  }

  async function saveTheme() {
    const css = serializeThemeCss(entries);
    setBusy(true);
    setStatus("");
    setSaveFlash(true);
    window.setTimeout(() => setSaveFlash(false), 250);
    if (demo) {
      setSavedCss(css);
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
          setSavedCss(saved);
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

  function loadSlot(slot: ThemeVariables | null) {
    if (!slot) return;
    const next = entriesFromVariables(slot);
    const css = serializeThemeCss(next);
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
    setEntries(next);
    setDraftValues({});
    applyThemeCss(serializeThemeCss(next), true);
    setStatus("Imported theme preview");
  }

  return <main className="fixed inset-0 z-50 overflow-y-auto bg-bg p-4 sm:p-6 lg:p-10"><div className="mx-auto w-full max-w-7xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-accent">Appearance</p><h2 className="mt-1 text-xl font-semibold text-fg">Theme editor</h2></div><button type="button" onClick={closeEditor} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted transition hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">Back to Settings</button></header>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6"><h3 className="text-base font-semibold text-fg">Colors</h3><div className="mt-5 grid gap-5 md:grid-cols-2">{THEME_VARIABLE_GROUPS.map((group) => <fieldset key={group.label} className="min-w-0 space-y-3"><legend className="mb-3 text-xs font-semibold uppercase text-muted">{group.label}</legend>{group.variables.map((key) => {
          const entry = entries.find((item) => item.key === key)!;
          const hexValue = draftValues[key] ?? entry.value;
          return <div key={key} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3"><input aria-label={`${labelFor(key)} color picker`} type="color" value={entry.value} onChange={(event) => { setDraftValues((current) => ({ ...current, [key]: event.target.value })); updateEntry(key, event.target.value); }} className="h-10 w-10 cursor-pointer rounded-lg border border-border-app bg-transparent p-1" /><label className="grid min-w-0 gap-1 text-xs font-medium text-muted">{labelFor(key)}<input aria-label={`${labelFor(key)} hex color`} value={hexValue} onChange={(event) => { const value = event.target.value; setDraftValues((current) => ({ ...current, [key]: value })); if (/^#[\da-f]{6}$/i.test(value)) updateEntry(key, value.toLowerCase()); }} className="min-h-9 w-full rounded-lg border border-border-app bg-surface-raised px-3 font-mono text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent" /></label></div>;
        })}</fieldset>)}</div></section>

        <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6"><div className="flex items-baseline justify-between gap-3"><h3 className="text-base font-semibold text-fg">Presets</h3><span className="text-xs text-muted">15 palettes</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{THEME_GROUPS.flatMap((group) => group.themes.map((preset) => <button key={preset.id} type="button" aria-pressed={theme === preset.id && !customCss} onClick={() => selectPreset(preset.id)} className={`min-w-0 rounded-xl border p-3 text-left transition hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${theme === preset.id && !customCss ? "border-accent bg-accent/10" : "border-border-app bg-surface"}`}><span className="mb-3 flex gap-1" aria-hidden="true">{THEME_SWATCHES[preset.id].map((color, index) => <span key={index} className="h-2 flex-1 rounded-full" style={{ backgroundColor: color }} />)}</span><span className="block truncate text-sm font-semibold text-fg">{preset.name}</span><span className="mt-1 block truncate text-[11px] text-muted">{group.label}</span></button>))}</div></section>

        <details className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20"><summary className="cursor-pointer text-sm font-semibold text-fg">Import or export CSS</summary><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void exportTheme()} className="rounded-lg border border-border-app px-3 py-2 text-sm font-semibold text-fg transition hover:bg-surface-raised">Export CSS</button><button type="button" onClick={importTheme} className="rounded-lg border border-border-app px-3 py-2 text-sm font-semibold text-fg transition hover:bg-surface-raised">Preview imported CSS</button></div><label className="mt-3 grid gap-1 text-xs font-medium text-muted">Theme CSS<textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={7} spellCheck={false} className="w-full rounded-lg border border-border-app bg-bg p-3 font-mono text-xs text-fg focus-visible:outline-2 focus-visible:outline-accent" /></label></details>
      </div>

      <aside className="space-y-6">
        <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20"><h3 className="text-base font-semibold text-fg">Preview</h3><div className="mt-4 rounded-xl border border-border-app bg-surface-raised p-4"><p className="text-xs font-semibold uppercase text-muted">MusiStats</p><p className="mt-2 text-lg font-semibold text-fg">Your listening, in color</p><p className="mt-1 text-sm text-muted">Preview text and surfaces</p><div className="mt-4 flex gap-2"><span className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-accent-fg">Accent</span><span className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs font-semibold text-error">Alert</span></div></div></section>

        <section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20"><div className="flex items-baseline justify-between gap-3"><h3 className="text-base font-semibold text-fg">Saved themes</h3><span className="text-xs text-muted">3 slots</span></div><div className="mt-4 space-y-3">{slots.map((slot, index) => <div key={index} className="flex items-center gap-2 rounded-xl border border-border-app p-2"><button type="button" disabled={!slot} onClick={() => loadSlot(slot)} className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left disabled:cursor-default"><span className="block text-sm font-semibold text-fg">Slot {index + 1}</span><span className="mt-1 flex gap-1">{slot ? THEME_VARIABLE_GROUPS.flatMap((group) => group.variables).slice(0, 4).map((key) => <span key={key} className="h-2 flex-1 rounded-full" style={{ backgroundColor: slot[key] }} />) : <span className="text-xs text-muted">Empty</span>}</span></button>{slot && <button type="button" aria-label={`Clear slot ${index + 1}`} onClick={() => clearSlot(index)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-error/10 hover:text-error focus-visible:outline-2 focus-visible:outline-accent">×</button>}<button type="button" aria-label={`Save current theme to slot ${index + 1}`} onClick={() => saveSlot(index)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">↓</button></div>)}</div></section>
      </aside>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-app pt-5"><p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">{status}</p><div className="flex gap-2"><button type="button" onClick={resetTheme} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted transition hover:bg-surface-raised hover:text-fg">Reset</button><button type="button" onClick={() => void saveTheme()} disabled={busy} style={saveFlash ? { background: "var(--success, var(--accent))" } : undefined} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-fg transition-all duration-100 hover:brightness-110 disabled:cursor-wait disabled:opacity-60">{busy ? "Saving…" : "Save theme"}</button></div></div>
  </div></main>;
}