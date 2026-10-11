/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { DEFAULT_THEME_ID, resolveThemeId, type ThemeId } from "./themePresets";
import { animateThemeChange, applyTheme, applyThemeAnimated, clearAppliedTheme, readCachedThemeCss } from "../theme/themeApply";

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  customCss: string | null;
  applyThemeCss: (css: string, animated?: boolean) => string | null;
};

const STORAGE_KEY = "musistats-theme:v2";
const LEGACY_STORAGE_KEY = "musistats-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readTheme(): ThemeId {
  try {
    return resolveThemeId(window.localStorage.getItem(STORAGE_KEY), window.localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [customCss, setCustomCss] = useState<string | null>(readCachedThemeCss);

  const selectTheme = useCallback((nextTheme: ThemeId) => {
    animateThemeChange(() => {
      document.documentElement.dataset.theme = nextTheme;
      clearAppliedTheme();
    });
    setTheme(nextTheme);
    setCustomCss(null);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // The current page still receives the selection when storage is unavailable.
    }
  }, []);

  const applyThemeCss = useCallback((css: string, animated = false) => {
    const applied = animated ? applyThemeAnimated(css) : applyTheme(css);
    if (applied) setCustomCss(applied);
    return applied;
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (customCss) applyTheme(customCss);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // The theme still works for this session when storage is unavailable.
    }
  }, [customCss, theme]);

  return <ThemeContext.Provider value={{ theme, setTheme: selectTheme, customCss, applyThemeCss }}>{children}</ThemeContext.Provider>;
}