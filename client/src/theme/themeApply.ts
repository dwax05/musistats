import { parseThemeCss, serializeThemeCss } from "./themeCss";

const THEME_STYLE_ID = "user-theme";
const TRANSITION_STYLE_ID = "theme-transition";
export const THEME_CACHE_KEY = "cache:theme:v2";

function getStyle(id: string) {
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  return style;
}

function importantCss(css: string) {
  return css.replace(/(#[\da-f]{6});/gi, "$1 !important;");
}

export function applyTheme(raw: string): string | null {
  const parsed = parseThemeCss(raw);
  if (!parsed) return null;
  const css = serializeThemeCss(Object.entries(parsed).map(([key, value]) => ({ key: key as keyof typeof parsed, value })));
  getStyle(THEME_STYLE_ID).textContent = importantCss(css);
  try {
    localStorage.setItem(THEME_CACHE_KEY, css);
  } catch {
    // The current page still receives the theme when storage is unavailable.
  }
  return css;
}

export function clearAppliedTheme() {
  document.getElementById(THEME_STYLE_ID)?.remove();
  try {
    localStorage.removeItem(THEME_CACHE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

export function applyThemeAnimated(raw: string, duration = 300): string | null {
  const transitions = getStyle(TRANSITION_STYLE_ID);
  transitions.textContent = `*, *::before, *::after { transition: background-color ${duration}ms ease, color ${duration}ms ease, border-color ${duration}ms ease, fill ${duration}ms ease, stroke ${duration}ms ease !important; }`;
  const css = applyTheme(raw);
  if (!css) {
    transitions.textContent = "";
    return null;
  }
  window.setTimeout(() => { transitions.textContent = ""; }, duration + 50);
  return css;
}

export function animateThemeChange(change: () => void, duration = 300) {
  const transitions = getStyle(TRANSITION_STYLE_ID);
  transitions.textContent = `*, *::before, *::after { transition: background-color ${duration}ms ease, color ${duration}ms ease, border-color ${duration}ms ease, fill ${duration}ms ease, stroke ${duration}ms ease !important; }`;
  change();
  window.setTimeout(() => { transitions.textContent = ""; }, duration + 50);
}

export function readCachedThemeCss() {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    return cached && parseThemeCss(cached) ? serializeThemeCss(Object.entries(parseThemeCss(cached)!).map(([key, value]) => ({ key: key as keyof ReturnType<typeof parseThemeCss>, value }))) : null;
  } catch {
    return null;
  }
}