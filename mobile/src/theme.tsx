import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ImageStyle, TextStyle, ViewStyle } from "react-native";

export const DESKTOP_BREAKPOINT = 1180;

export type VitoThemeName = "ledger-dark";

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
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    round: number;
  };
};

export const themes: Record<VitoThemeName, VitoTheme> = {
  "ledger-dark": {
    name: "ledger-dark",
    dark: true,
    colors: {
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
    },
    space: {
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
    },
    radius: { sm: 6, md: 10, lg: 14, round: 999 },
  },
};

const ThemeContext = createContext<VitoTheme | null>(null);

export function VitoThemeProvider({
  children,
  themeName = "ledger-dark",
}: {
  children: ReactNode;
  themeName?: VitoThemeName;
}) {
  const theme = useMemo(() => themes[themeName], [themeName]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useVitoTheme(): VitoTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useVitoTheme must be used inside VitoThemeProvider");
  return theme;
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
