export const THEME_GROUPS = [
  {
    label: "Purple / moody",
    themes: [
      { id: "catppuccin-mocha", name: "Catppuccin Mocha" },
      { id: "dracula", name: "Dracula" },
      { id: "rose-pine", name: "Rosé Pine" },
    ],
  },
  {
    label: "Blue / cool",
    themes: [
      { id: "tokyo-night", name: "Tokyo Night" },
      { id: "nord", name: "Nord" },
      { id: "one-dark", name: "One Dark" },
    ],
  },
  {
    label: "Warm / earthy",
    themes: [
      { id: "gruvbox", name: "Gruvbox" },
      { id: "everforest", name: "Everforest" },
      { id: "kanagawa", name: "Kanagawa" },
    ],
  },
  {
    label: "Solarized / light",
    themes: [
      { id: "solarized-dark", name: "Solarized Dark" },
      { id: "solarized-light", name: "Solarized Light" },
      { id: "catppuccin-latte", name: "Catppuccin Latte" },
    ],
  },
  {
    label: "Slate / special",
    themes: [
      { id: "ayu-mirage", name: "Ayu Mirage" },
      { id: "retro", name: "Retro" },
      { id: "ucf-knights", name: "UCF Knights" },
    ],
  },
] as const;

export type ThemeId = (typeof THEME_GROUPS)[number]["themes"][number]["id"];
type ThemeOption = { id: ThemeId; name: string };

export const DEFAULT_THEME_ID: ThemeId = "ucf-knights";
export const THEME_SWATCHES: Record<ThemeId, readonly [string, string, string, string]> = {
  "catppuccin-mocha": ["#1e1e2e", "#313244", "#cba6f7", "#f38ba8"],
  dracula: ["#282a36", "#343746", "#ff79c6", "#ff5555"],
  "rose-pine": ["#191724", "#1f1d2e", "#c4a7e7", "#eb6f92"],
  "tokyo-night": ["#1a1b26", "#24283b", "#7aa2f7", "#f7768e"],
  nord: ["#2e3440", "#3b4252", "#88c0d0", "#bf616a"],
  "one-dark": ["#282c34", "#21252b", "#61afef", "#e06c75"],
  gruvbox: ["#282828", "#32302f", "#fabd2f", "#fb4934"],
  everforest: ["#2d353b", "#343f44", "#a7c080", "#e67e80"],
  kanagawa: ["#1f1f28", "#2a2a37", "#7e9cd8", "#e46876"],
  "solarized-dark": ["#002b36", "#073642", "#2aa198", "#dc322f"],
  "solarized-light": ["#fdf6e3", "#eee8d5", "#268bd2", "#dc322f"],
  "catppuccin-latte": ["#eff1f5", "#e6e9ef", "#8839ef", "#d20f39"],
  "ayu-mirage": ["#1f2430", "#242936", "#ffcc66", "#f28779"],
  retro: ["#0f1712", "#17231b", "#efb755", "#e06c75"],
  "ucf-knights": ["#0d0d0d", "#171717", "#ffc904", "#e06c75"],
};
export const THEME_PRESETS = THEME_GROUPS.reduce<ThemeOption[]>((presets, group) => {
  presets.push(...group.themes);
  return presets;
}, []);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_PRESETS.some((theme) => theme.id === value);
}

export function resolveThemeId(value: unknown, legacyValue?: unknown): ThemeId {
  if (isThemeId(value)) return value;
  if (legacyValue === "light") return "solarized-light";
  return DEFAULT_THEME_ID;
}