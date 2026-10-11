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