/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { DEFAULT_THEME_ID, resolveThemeId, type ThemeId } from "./themePresets";

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
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

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // The theme still works for this session when storage is unavailable.
    }
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}