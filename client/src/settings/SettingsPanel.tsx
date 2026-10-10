import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResponse } from "../auth/AuthProvider";
import { isActiveImport, isCreatedImportData, isImportData, isImportsData, isImportTransitionData, sourceLabel, type ImportSummary } from "./model";

type SettingsPanelProps = {
  authedPost: (url: string, body?: unknown) => Promise<ApiResponse>;
};

function messageFor(error: string) {
  if (error === "import_in_progress") return "An import is already running. Finish or cancel it before starting another.";
  if (error === "upload_too_large" || error === "export_too_large") return "That export is too large to import.";
  if (error === "no_music_history_files") return "No music history in that selection. Choose the StreamingHistory_music_*.json files (or the original export ZIP).";
  if (error === "unsupported_export" || error === "unsupported_file_type") return "Choose Spotify Streaming History JSON files or the original export ZIP.";
  return "Your import could not be completed. Please try again.";
}

function formatStatus(status: ImportSummary["status"]) {
  return status.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatRange(dateRange: ImportSummary["dateRange"]) {
  if (!dateRange) return "Finding listening range";
  const format = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });
  return `${format.format(new Date(dateRange.start))} – ${format.format(new Date(dateRange.end))}`;
}

function pendingImport(imported: { id: string; status: ImportSummary["status"]; sourceKinds: ImportSummary["sourceKinds"]; createdAt: string }): ImportSummary {
  return {
    ...imported,
    startedAt: null,
    completedAt: null,
    dateRange: null,
    counts: { files: 0, rowsRead: 0, tracksImported: 0, duplicates: 0, skipped: 0, enriched: 0 },
    skippedByReason: {},
    failureCode: null,
  };
}

function ImportRow({ imported, onCancel, onDelete, busy, confirmingDelete }: { imported: ImportSummary; onCancel: (id: string) => void; onDelete: (id: string) => void; busy: boolean; confirmingDelete: boolean }) {
  const active = isActiveImport(imported.status);
  const cancelled = imported.status === "cancelled";
  const deleteClass = `rounded-lg text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmingDelete ? "destructive-confirmation bg-error px-3 py-2 text-white" : "px-3 py-2 text-error hover:bg-error/10"}`;
  const deleteLabel = confirmingDelete ? "Click again to remove" : "Remove import";
  return <li className="rounded-2xl border border-border-app/80 bg-surface-raised/50 p-4 sm:p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-fg">{sourceLabel(imported.sourceKinds)}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${imported.status === "completed" ? "bg-accent/15 text-accent" : imported.status === "failed" ? "bg-error/10 text-error" : "bg-surface text-muted"}`}>{formatStatus(imported.status)}</span></div><p className="mt-1 text-xs text-muted">{formatRange(imported.dateRange)} · Started {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(imported.createdAt))}</p></div>{active ? <button type="button" onClick={() => onCancel(imported.id)} disabled={busy} className="rounded-lg border border-border-app px-3 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60">Cancel import</button> : cancelled ? <button type="button" aria-label={deleteLabel} title={deleteLabel} onClick={() => onDelete(imported.id)} disabled={busy} className={`grid h-9 w-9 place-items-center ${deleteClass}`}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M4 7h16M10 11v6m4-6v6M9 7l1-2h4l1 2m-9 0 1 13h10l1-13" /></svg></button> : imported.status === "completed" ? <button type="button" onClick={() => onDelete(imported.id)} disabled={busy} className={deleteClass}>{deleteLabel}</button> : null}</div><div className="mt-4 grid grid-cols-3 gap-3 border-t border-border-app pt-4 text-xs"><p><span className="block font-semibold text-fg">{imported.counts.tracksImported.toLocaleString()}</span><span className="text-muted">added</span></p><p><span className="block font-semibold text-fg">{imported.counts.duplicates.toLocaleString()}</span><span className="text-muted">duplicates</span></p><p><span className="block font-semibold text-fg">{imported.counts.skipped.toLocaleString()}</span><span className="text-muted">skipped</span></p></div>{imported.failureCode && <p className="mt-4 text-xs text-error">Import failed: {imported.failureCode.replace(/_/g, " ")}.</p>}</li>;
}

export default function SettingsPanel({ authedPost }: SettingsPanelProps) {
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeImportId = imports.find((imported) => isActiveImport(imported.status))?.id;

  const updateImport = useCallback((next: ImportSummary) => {
    setImports((current) => [next, ...current.filter((imported) => imported.id !== next.id)].sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  }, []);

  const loadImports = useCallback(async () => {
    const response = await authedPost("/api/imports/spotify-history/list", { limit: 20 });
    if (isImportsData(response)) setImports(response.imports);
    else setError(messageFor(response.error));
    setLoading(false);
  }, [authedPost]);

  // oxlint-disable-next-line react/set-state-in-effect -- Import history comes from the server after mount.
  useEffect(() => { void loadImports(); }, [loadImports]);

  useEffect(() => {
    if (!activeImportId) return;
    let active = true;
    async function poll() {
      const response = await authedPost("/api/imports/spotify-history/status", { importId: activeImportId });
      if (!active) return;
      if (isImportData(response)) updateImport(response.import);
      else setError(messageFor(response.error));
    }
    void poll();
    const intervalId = window.setInterval(() => void poll(), 1500);
    return () => { active = false; window.clearInterval(intervalId); };
  }, [activeImportId, authedPost, updateImport]);

  useEffect(() => {
    if (!confirmingDeleteId) return;
    const timeoutId = window.setTimeout(() => setConfirmingDeleteId(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [confirmingDeleteId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    const body = new FormData();
    for (const file of Array.from(files)) body.append("files", file);
    const response = await authedPost("/api/imports/spotify-history", body);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (!isCreatedImportData(response)) {
      setError(messageFor(response.error));
      return;
    }
    updateImport(pendingImport(response.import));
    void loadImports();
  }

  async function cancel(importId: string) {
    setActionId(importId);
    setError("");
    const response = await authedPost("/api/imports/spotify-history/cancel", { importId });
    setActionId(null);
    if (!isImportTransitionData(response)) {
      setError(messageFor(response.error));
      return;
    }
    setImports((current) => current.map((imported) => imported.id === importId ? { ...imported, status: response.import.status } : imported));
  }

  async function remove(importId: string) {
    if (confirmingDeleteId !== importId) return setConfirmingDeleteId(importId);
    setConfirmingDeleteId(null);
    setActionId(importId);
    setError("");
    const response = await authedPost("/api/imports/spotify-history/delete", { importId });
    setActionId(null);
    if (response.error || response.deleted !== true) {
      setError(messageFor(response.error));
      return;
    }
    setImports((current) => current.filter((imported) => imported.id !== importId));
  }

  const importing = uploading || Boolean(activeImportId);
  return <div className="space-y-6"><section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-semibold text-fg">Import Spotify history</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted">Select the music files from your export — StreamingHistory_music_*.json or Streaming_History_Audio_*.json — or upload the original Spotify ZIP and we take just the music files from it. Overlapping plays are safely skipped.</p></div><a href="https://support.spotify.com/article/understanding-your-data/" target="_blank" rel="noreferrer" className="shrink-0 text-sm font-semibold text-accent hover:underline">How to request your data</a></div><div className="mt-6 rounded-xl border border-dashed border-border-app bg-surface-raised/60 p-5"><input ref={inputRef} id="spotify-history-files" type="file" accept=".json,.zip,application/json,application/zip" multiple onChange={(event) => void upload(event.target.files)} disabled={importing} className="sr-only" /><label htmlFor="spotify-history-files" className={`inline-flex cursor-pointer items-center rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-bg transition hover:brightness-110 ${importing ? "pointer-events-none opacity-60" : ""}`}>{uploading ? "Uploading…" : activeImportId ? "Import in progress" : "Choose Spotify export"}</label><p className="mt-3 text-xs leading-5 text-muted">Podcast, audiobook and everything else in the export is ignored. Raw export files are processed for this import and are not kept as part of your listening library.</p></div>{error && <p role="alert" className="mt-4 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</p>}</section><section className="rounded-2xl border border-border-app/80 bg-surface/95 p-5 shadow-xl shadow-black/20 sm:p-6"><div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold text-fg">Import history</h2><p className="mt-1 text-sm text-muted">Completed imports can be removed without touching plays from another source.</p></div></div>{loading ? <div className="mt-5 h-28 animate-pulse rounded-xl bg-surface-raised" /> : imports.length ? <ol aria-live="polite" className="mt-5 space-y-3">{imports.map((imported) => <ImportRow key={imported.id} imported={imported} onCancel={cancel} onDelete={remove} busy={actionId === imported.id} confirmingDelete={confirmingDeleteId === imported.id} />)}</ol> : <p className="py-10 text-center text-sm text-muted">No Spotify history imports yet.</p>}</section></div>;
}
