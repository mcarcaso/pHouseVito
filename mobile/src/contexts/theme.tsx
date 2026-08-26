import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";

export const DESKTOP_BREAKPOINT = 1180;

export type VitoThemeName =
  | "ledger-dark"
  | "midnight"
  | "graphite"
  | "nord"
  | "dracula"
  | "monokai"
  | "forest"
  | "espresso"
  | "oxblood"
  | "solarized-dark"
  | "paper"
  | "warm-paper"
  | "solarized-light"
  | "rose"
  | "ocean-light";

export type VitoTheme = {
  name: VitoThemeName;
  dark: boolean;
  colors: {
    canvas: string;
    sidebar: string;
    surface: string;
    surfaceRaised: string;
    separator: string;
    separatorStrong: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentSurface: string;
    accentText: string;
    info: string;
    infoSurface: string;
    success: string;
    successSurface: string;
    warning: string;
    danger: string;
    dangerSurface: string;
  };
  space: {
    none: number;
    xxs: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    xxxl: number;
    huge: number;
    giant: number;
    massive: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    round: number;
  };
};

const space = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  giant: 64,
  massive: 80,
};
const radius = { sm: 6, md: 10, lg: 14, round: 999 };
type ThemeColors = VitoTheme["colors"];
const darkBase: ThemeColors = {
  canvas: "#0b0d0b",
  sidebar: "#0f120f",
  surface: "#151915",
  surfaceRaised: "#202520",
  separator: "#292e29",
  separatorStrong: "#596159",
  text: "#f0f2ed",
  textSecondary: "#a2a9a1",
  textMuted: "#7e877e",
  accent: "#a3be8c",
  accentSurface: "#1c261b",
  accentText: "#10150d",
  info: "#64a8ff",
  infoSurface: "#101b24",
  success: "#55c787",
  successSurface: "#102019",
  warning: "#e7b85b",
  danger: "#ef827b",
  dangerSurface: "#251313",
};
const lightBase: ThemeColors = {
  canvas: "#f4f4f1",
  sidebar: "#ebece7",
  surface: "#ffffff",
  surfaceRaised: "#e5e7e1",
  separator: "#d7d9d2",
  separatorStrong: "#a7aca2",
  text: "#171a17",
  textSecondary: "#4e554e",
  textMuted: "#737b73",
  accent: "#426b36",
  accentSurface: "#e0eadc",
  accentText: "#ffffff",
  info: "#246eb9",
  infoSurface: "#e2eef9",
  success: "#237a49",
  successSurface: "#e0f1e7",
  warning: "#a66a00",
  danger: "#b83f3a",
  dangerSurface: "#f8e4e2",
};
const makeTheme = (
  name: VitoThemeName,
  dark: boolean,
  colors: Partial<ThemeColors>,
): VitoTheme => ({
  name,
  dark,
  colors: { ...(dark ? darkBase : lightBase), ...colors },
  space,
  radius,
});

export const themes: Record<VitoThemeName, VitoTheme> = {
  "ledger-dark": makeTheme("ledger-dark", true, {}),
  midnight: makeTheme("midnight", true, {
    canvas: "#080d18",
    sidebar: "#0c1322",
    surface: "#111a2b",
    surfaceRaised: "#19263b",
    separator: "#26344a",
    separatorStrong: "#51627d",
    accent: "#7aa2f7",
    accentSurface: "#152342",
  }),
  graphite: makeTheme("graphite", true, {
    canvas: "#101010",
    sidebar: "#151515",
    surface: "#1c1c1c",
    surfaceRaised: "#292929",
    separator: "#333",
    separatorStrong: "#606060",
    accent: "#d0d0d0",
    accentSurface: "#303030",
    accentText: "#111",
  }),
  nord: makeTheme("nord", true, {
    canvas: "#242933",
    sidebar: "#2b303b",
    surface: "#303744",
    surfaceRaised: "#3b4252",
    separator: "#434c5e",
    separatorStrong: "#66738a",
    text: "#eceff4",
    textSecondary: "#d8dee9",
    accent: "#88c0d0",
    accentSurface: "#324956",
    accentText: "#172126",
  }),
  dracula: makeTheme("dracula", true, {
    canvas: "#1e1f29",
    sidebar: "#242631",
    surface: "#282a36",
    surfaceRaised: "#343746",
    separator: "#44475a",
    separatorStrong: "#686b7e",
    accent: "#bd93f9",
    accentSurface: "#392f50",
    success: "#50fa7b",
    danger: "#ff5555",
  }),
  monokai: makeTheme("monokai", true, {
    canvas: "#191a16",
    sidebar: "#20211c",
    surface: "#272822",
    surfaceRaised: "#34352e",
    separator: "#44453d",
    separatorStrong: "#68695f",
    accent: "#a6e22e",
    accentSurface: "#303d1b",
    danger: "#f92672",
    warning: "#e6db74",
  }),
  forest: makeTheme("forest", true, {
    canvas: "#07110d",
    sidebar: "#0b1812",
    surface: "#102219",
    surfaceRaised: "#183127",
    separator: "#234537",
    separatorStrong: "#49705f",
    accent: "#69d29a",
    accentSurface: "#113725",
  }),
  espresso: makeTheme("espresso", true, {
    canvas: "#17110e",
    sidebar: "#201713",
    surface: "#2a1f19",
    surfaceRaised: "#382a22",
    separator: "#4b382d",
    separatorStrong: "#775e4e",
    accent: "#d6a56f",
    accentSurface: "#412d1d",
    text: "#f5eadf",
    textSecondary: "#cdbbac",
    textMuted: "#aa9585",
  }),
  oxblood: makeTheme("oxblood", true, {
    canvas: "#13090c",
    sidebar: "#1c0d12",
    surface: "#281219",
    surfaceRaised: "#391b24",
    separator: "#512632",
    separatorStrong: "#794452",
    accent: "#e28a9f",
    accentSurface: "#481a28",
  }),
  "solarized-dark": makeTheme("solarized-dark", true, {
    canvas: "#002b36",
    sidebar: "#073642",
    surface: "#0b3d48",
    surfaceRaised: "#174b56",
    separator: "#285b65",
    separatorStrong: "#657b83",
    text: "#fdf6e3",
    textSecondary: "#93a1a1",
    accent: "#2aa198",
    accentSurface: "#0d4b4c",
  }),
  paper: makeTheme("paper", false, {}),
  "warm-paper": makeTheme("warm-paper", false, {
    canvas: "#f5f0e6",
    sidebar: "#ede5d7",
    surface: "#fffaf0",
    surfaceRaised: "#e8dfcf",
    separator: "#d8cdbb",
    separatorStrong: "#a99b86",
    accent: "#735c35",
    accentSurface: "#ebe0cb",
  }),
  "solarized-light": makeTheme("solarized-light", false, {
    canvas: "#fdf6e3",
    sidebar: "#eee8d5",
    surface: "#fffaf0",
    surfaceRaised: "#e8e1cc",
    separator: "#d6cfba",
    separatorStrong: "#93a1a1",
    text: "#073642",
    textSecondary: "#586e75",
    accent: "#268bd2",
    accentSurface: "#dcecf3",
  }),
  rose: makeTheme("rose", false, {
    canvas: "#fff7f8",
    sidebar: "#f8eaed",
    surface: "#ffffff",
    surfaceRaised: "#f2e1e5",
    separator: "#e5ccd2",
    separatorStrong: "#b98e99",
    accent: "#a64560",
    accentSurface: "#f5dce3",
  }),
  "ocean-light": makeTheme("ocean-light", false, {
    canvas: "#f2f8fa",
    sidebar: "#e5f0f3",
    surface: "#ffffff",
    surfaceRaised: "#dcebef",
    separator: "#c8dce1",
    separatorStrong: "#88aab3",
    accent: "#176b80",
    accentSurface: "#d7edf2",
  }),
};

const THEME_KEY = "vito-color-scheme";
const ThemeContext = createContext<VitoTheme | null>(null);
const ThemeControllerContext = createContext<{
  themeName: VitoThemeName;
  setThemeName: (name: VitoThemeName) => void;
} | null>(null);

export function VitoThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState<VitoThemeName>("ledger-dark");
  useEffect(() => {
    void (async () => {
      const saved =
        Platform.OS === "web"
          ? globalThis.localStorage?.getItem(THEME_KEY)
          : await SecureStore.getItemAsync(THEME_KEY);
      if (saved && saved in themes) setThemeNameState(saved as VitoThemeName);
    })();
  }, []);
  const setThemeName = (name: VitoThemeName) => {
    setThemeNameState(name);
    if (Platform.OS === "web") globalThis.localStorage?.setItem(THEME_KEY, name);
    else void SecureStore.setItemAsync(THEME_KEY, name);
  };
  const theme = useMemo(() => themes[themeName], [themeName]);
  const controller = useMemo(() => ({ themeName, setThemeName }), [themeName]);
  return (
    <ThemeControllerContext.Provider value={controller}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemeControllerContext.Provider>
  );
}

export function useVitoTheme(): VitoTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useVitoTheme must be used inside VitoThemeProvider");
  return theme;
}

export function useVitoThemeController() {
  const controller = useContext(ThemeControllerContext);
  if (!controller) throw new Error("useVitoThemeController must be used inside VitoThemeProvider");
  return controller;
}

const styleCache = new WeakMap<VitoTheme, Map<StyleFactory<NamedStyles>, NamedStyles>>();

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;
type StyleFactory<T extends NamedStyles> = (theme: VitoTheme) => T;

export function useThemeStyles<T extends NamedStyles>(factory: StyleFactory<T>): T {
  const theme = useVitoTheme();
  let themeStyles = styleCache.get(theme);
  if (!themeStyles) {
    themeStyles = new Map();
    styleCache.set(theme, themeStyles);
  }
  let styles = themeStyles.get(factory) as T | undefined;
  if (!styles) {
    styles = factory(theme);
    themeStyles.set(factory, styles);
  }
  return styles;
}
