export const THEME_VARIABLES = ["--bg", "--surface", "--surface-raised", "--border", "--fg", "--muted", "--accent", "--accent-fg", "--error"] as const;
export type ThemeVariable = (typeof THEME_VARIABLES)[number];
export type ThemeSlot = Record<ThemeVariable, string>;
export type ThemeSlots = [ThemeSlot | null, ThemeSlot | null, ThemeSlot | null];

const allowed = new Set<string>(THEME_VARIABLES);
const emptySlots: ThemeSlots = [null, null, null];
const blocked = /url\s*\(|expression\s*\(|javascript\s*:|@import/i;
const declarationPattern = /^(--[a-z-]+)\s*:\s*(#[\da-f]{6})$/i;

export function sanitizeThemeCss(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096 || blocked.test(value)) return null;
  const trimmed = value.trim();
  const root = /^:root\s*\{([\s\S]*)\}$/.exec(trimmed);
  const body = root ? root[1]! : trimmed;
  if (/[{}@]/.test(body)) return null;

  const variables = new Map<ThemeVariable, string>();
  for (const declaration of body.split(";")) {
    const part = declaration.trim();
    if (!part) continue;
    const match = declarationPattern.exec(part);
    if (!match || !allowed.has(match[1]!)) return null;
    variables.set(match[1] as ThemeVariable, match[2]!.toLowerCase());
  }
  if (!variables.size) return null;
  return `:root {\n${THEME_VARIABLES.filter((key) => variables.has(key)).map((key) => `  ${key}: ${variables.get(key)};`).join("\n")}\n}`;
}

function isThemeSlot(value: unknown): value is ThemeSlot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === THEME_VARIABLES.length
    && THEME_VARIABLES.every((key) => typeof record[key] === "string" && /^#[\da-f]{6}$/i.test(record[key] as string));
}

export function isThemeSlots(value: unknown): value is ThemeSlots {
  return Array.isArray(value) && value.length === 3 && value.every((slot) => slot === null || isThemeSlot(slot));
}

export function emptyThemeSlots(): ThemeSlots {
  return [...emptySlots];
}