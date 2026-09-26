import * as SecureStore from "expo-secure-store";
import { resolveThemePreferences, themes } from "./theme-palettes";
import type { ThemeAppearance, VitoTheme, VitoThemeName } from "./theme-palettes";
export { paletteNames, themes } from "./theme-palettes";
export type { ThemeAppearance, VitoTheme, VitoThemeName } from "./theme-palettes";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Platform,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";

export const DESKTOP_BREAKPOINT = 1180;

const LEGACY_KEY = "vito-color-scheme";
const PALETTE_KEY = "vito-color-palette";
const APPEARANCE_KEY = "vito-appearance";

const ThemeContext = createContext<VitoTheme | null>(null);
const ThemeControllerContext = createContext<{
  themeName: VitoThemeName;
  setThemeName: (name: VitoThemeName) => void;
  appearance: ThemeAppearance;
  setAppearance: (value: ThemeAppearance) => void;
} | null>(null);

export function VitoThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState<VitoThemeName>("ledger");
  const [appearance, setAppearanceState] = useState<ThemeAppearance>("dark");
  const systemScheme = useColorScheme();
  const editedPalette = useRef(false);
  const editedAppearance = useRef(false);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const get = (key: string) =>
        Platform.OS === "web"
          ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
          : SecureStore.getItemAsync(key);
      try {
        const [savedPalette, savedAppearance, legacy] = await Promise.all([
          get(PALETTE_KEY),
          get(APPEARANCE_KEY),
          get(LEGACY_KEY),
        ]);
        if (!mounted) return;
        const { palette, appearance: mode } = resolveThemePreferences(
          savedPalette,
          savedAppearance,
          legacy,
        );
        if (!editedPalette.current) setThemeNameState(palette);
        if (!editedAppearance.current) setAppearanceState(mode);
      } catch (error) {
        console.warn("Could not load theme preferences", error);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const save = (key: string, value: string) => {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key, value);
    else void SecureStore.setItemAsync(key, value);
  };
  const setThemeName = (name: VitoThemeName) => {
    editedPalette.current = true;
    setThemeNameState(name);
    save(PALETTE_KEY, name);
  };
  const setAppearance = (value: ThemeAppearance) => {
    editedAppearance.current = true;
    setAppearanceState(value);
    save(APPEARANCE_KEY, value);
  };
  const resolved =
    appearance === "system" ? (systemScheme === "dark" ? "dark" : "light") : appearance;
  const theme = themes[themeName][resolved];
  const controller = useMemo(
    () => ({ themeName, setThemeName, appearance, setAppearance }),
    [themeName, appearance],
  );
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
