export const THEME_VARIABLE_GROUPS = [
  { label: "Page", variables: ["--bg", "--fg", "--surface", "--surface-raised", "--border", "--muted"] },
  { label: "Accents", variables: ["--accent", "--accent-fg", "--error"] },
] as const;

export type ThemeVariable = (typeof THEME_VARIABLE_GROUPS)[number]["variables"][number];
export type ThemeVariables = Record<ThemeVariable, string>;
export type ThemeSlots = [ThemeVariables | null, ThemeVariables | null, ThemeVariables | null];
export type ThemeEntry = { key: ThemeVariable; value: string };

export const DEFAULT_THEME_VARIABLES: ThemeVariables = {
  "--bg": "#0d0d0d",
  "--surface": "#171717",
  "--surface-raised": "#24231f",
  "--border": "#453f2a",
  "--fg": "#fff9db",
  "--muted": "#b7ad85",
  "--accent": "#ffc904",
  "--accent-fg": "#201900",
  "--error": "#e06c75",
};

const allowedVariables = new Set<string>(THEME_VARIABLE_GROUPS.flatMap((group) => [...group.variables]));
export const THEME_VARIABLE_KEYS = [...allowedVariables] as ThemeVariable[];
const forbiddenContent = /url\s*\(|expression\s*\(|javascript\s*:|@import/i;

export function entriesFromVariables(variables: ThemeVariables): ThemeEntry[] {
  return THEME_VARIABLE_GROUPS.flatMap((group) => group.variables.map((key) => ({ key, value: variables[key] })));
}

export function serializeThemeCss(entries: ThemeEntry[]): string {
  const values = new Map(entries.map(({ key, value }) => [key, value]));
  const body = entriesFromVariables(Object.fromEntries(
    [...allowedVariables].map((key) => [key, values.get(key as ThemeVariable) ?? DEFAULT_THEME_VARIABLES[key as ThemeVariable]]),
  ) as ThemeVariables).map(({ key, value }) => `  ${key}: ${value};`).join("\n");
  return `:root {\n${body}\n}`;
}

export function parseThemeCss(raw: string): ThemeVariables | null {
  if (typeof raw !== "string" || raw.length > 4096 || forbiddenContent.test(raw)) return null;
  const trimmed = raw.trim();
  const rootMatch = /^:root\s*\{([\s\S]*)\}$/.exec(trimmed);
  const body = rootMatch ? rootMatch[1]! : trimmed;
  if (/[{}@]/.test(body)) return null;

  const values: ThemeVariables = { ...DEFAULT_THEME_VARIABLES };
  let parsed = 0;
  for (const declaration of body.split(";")) {
    const part = declaration.trim();
    if (!part) continue;
    const match = /^(--[a-z-]+)\s*:\s*(#[\da-f]{6})$/i.exec(part);
    if (!match || !allowedVariables.has(match[1]!)) return null;
    values[match[1] as ThemeVariable] = match[2]!.toLowerCase();
    parsed += 1;
  }
  return parsed ? values : null;
}

export function isThemeVariables(value: unknown): value is ThemeVariables {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === THEME_VARIABLE_KEYS.length
    && THEME_VARIABLE_KEYS.every((key) => typeof record[key] === "string" && /^#[\da-f]{6}$/i.test(record[key] as string));
}

export function isThemeSlots(value: unknown): value is ThemeSlots {
  return Array.isArray(value) && value.length === 3 && value.every((slot) => slot === null || isThemeVariables(slot));
}

export function computedThemeVariables(): ThemeVariables {
  if (typeof document === "undefined") return { ...DEFAULT_THEME_VARIABLES };
  const style = getComputedStyle(document.documentElement);
  const variables = { ...DEFAULT_THEME_VARIABLES };
  for (const key of allowedVariables) {
    const value = style.getPropertyValue(key).trim();
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
    const hex = /^#[\da-f]{6}$/i.test(value) ? value : rgb ? `#${rgb.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}` : null;
    if (hex) variables[key as ThemeVariable] = hex.toLowerCase();
  }
  return variables;
}
// Black or white, whichever reads better on the given #rrggbb background.
export function readableOn(hex: string) {
  const rgb = parseInt(hex.slice(1), 16);
  return ((rgb >> 16) * 299 + ((rgb >> 8) & 255) * 587 + (rgb & 255) * 114) / 1000 > 150 ? "#000000" : "#ffffff";
}
