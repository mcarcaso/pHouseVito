export const paletteNames = [
  "ledger",
  "midnight",
  "graphite",
  "nord",
  "dracula",
  "monokai",
  "forest",
  "espresso",
  "oxblood",
  "solarized",
  "paper",
  "warm-paper",
  "rose",
  "ocean",
  "cobalt",
  "lavender",
  "jade",
  "amber",
  "slate",
  "sand",
  "tangerine",
  "plum",
] as const;
export type VitoThemeName = (typeof paletteNames)[number];
export type ThemeAppearance = "light" | "dark" | "system";

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

const legacyThemes = {
  "ledger-dark": makeTheme("ledger", true, {}),
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
  "solarized-dark": makeTheme("solarized", true, {
    canvas: "#002b36",
    sidebar: "#073642",
    surface: "#0b3d48",
    surfaceRaised: "#174b56",
    separator: "#285b65",
    separatorStrong: "#657b83",
    text: "#fdf6e3",
    textSecondary: "#a5b4b4",
    accent: "#65c8b5",
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
  "solarized-light": makeTheme("solarized", false, {
    canvas: "#fdf6e3",
    sidebar: "#eee8d5",
    surface: "#fffaf0",
    surfaceRaised: "#e8e1cc",
    separator: "#d6cfba",
    separatorStrong: "#93a1a1",
    text: "#073642",
    textSecondary: "#586e75",
    accent: "#17699e",
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
  "ocean-light": makeTheme("ocean", false, {
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

// Preserve the original variants as the matching half of their new palette families.
// Complementary variants have their own surface, border and accent tokens; they are
// not a blanket color inversion of the other mode.
const pair = (name: VitoThemeName, light: Partial<ThemeColors>, dark: Partial<ThemeColors>) => ({
  light: makeTheme(name, false, light),
  dark: makeTheme(name, true, dark),
});
export const themes: Record<VitoThemeName, { light: VitoTheme; dark: VitoTheme }> = {
  ledger: {
    light: pair("ledger", { canvas: "#f1f4f0", sidebar: "#e5eae4", accent: "#345c39" }, {}).light,
    dark: legacyThemes["ledger-dark"],
  },
  midnight: {
    light: pair(
      "midnight",
      {
        canvas: "#f0f4fc",
        sidebar: "#e1e9f7",
        surfaceRaised: "#e3ebf8",
        separator: "#cad5ea",
        accent: "#315bac",
        accentSurface: "#dce6fb",
      },
      {},
    ).light,
    dark: legacyThemes.midnight,
  },
  graphite: {
    light: pair(
      "graphite",
      {
        canvas: "#f3f3f3",
        sidebar: "#e9e9e9",
        surfaceRaised: "#e5e5e5",
        separator: "#d1d1d1",
        accent: "#353535",
        accentSurface: "#e5e5e5",
      },
      {},
    ).light,
    dark: legacyThemes.graphite,
  },
  nord: {
    light: pair(
      "nord",
      {
        canvas: "#eceff4",
        sidebar: "#e0e5ed",
        surface: "#f9fbfd",
        surfaceRaised: "#dce3eb",
        separator: "#c5d0dc",
        accent: "#366580",
        accentSurface: "#d7eaf1",
      },
      {},
    ).light,
    dark: legacyThemes.nord,
  },
  dracula: {
    light: pair(
      "dracula",
      {
        canvas: "#f6f3fb",
        sidebar: "#ede6f5",
        surfaceRaised: "#ede6f6",
        separator: "#d7cae6",
        accent: "#694494",
        accentSurface: "#eadcf6",
      },
      {},
    ).light,
    dark: legacyThemes.dracula,
  },
  monokai: {
    light: pair(
      "monokai",
      {
        canvas: "#f8f8ee",
        sidebar: "#edeee0",
        surfaceRaised: "#e9eaca",
        separator: "#d2d5bb",
        accent: "#4d6719",
        accentSurface: "#e9f2d1",
      },
      {},
    ).light,
    dark: legacyThemes.monokai,
  },
  forest: {
    light: pair(
      "forest",
      {
        canvas: "#eff6ee",
        sidebar: "#deebdc",
        surfaceRaised: "#e0ebde",
        separator: "#c1d9c2",
        accent: "#276544",
        accentSurface: "#d8efdc",
      },
      {},
    ).light,
    dark: legacyThemes.forest,
  },
  espresso: {
    light: pair(
      "espresso",
      {
        canvas: "#f7f2ec",
        sidebar: "#eee3d8",
        surfaceRaised: "#ebe0d4",
        separator: "#d9c8b6",
        accent: "#705039",
        accentSurface: "#efdfce",
      },
      {},
    ).light,
    dark: legacyThemes.espresso,
  },
  oxblood: {
    light: pair(
      "oxblood",
      {
        canvas: "#faf2f3",
        sidebar: "#f0e2e4",
        surfaceRaised: "#efe0e4",
        separator: "#ddc5ca",
        accent: "#87364c",
        accentSurface: "#f5e0e5",
      },
      {},
    ).light,
    dark: legacyThemes.oxblood,
  },
  solarized: { light: legacyThemes["solarized-light"], dark: legacyThemes["solarized-dark"] },
  paper: {
    light: legacyThemes.paper,
    dark: pair(
      "paper",
      {},
      {
        canvas: "#20211e",
        sidebar: "#282a25",
        surface: "#30322c",
        surfaceRaised: "#3c4037",
        separator: "#52574b",
        accent: "#d0d9b1",
        accentSurface: "#414834",
      },
    ).dark,
  },
  "warm-paper": {
    light: legacyThemes["warm-paper"],
    dark: pair(
      "warm-paper",
      {},
      {
        canvas: "#261f19",
        sidebar: "#30261d",
        surface: "#392d23",
        surfaceRaised: "#48392c",
        separator: "#604b39",
        text: "#f7e9d3",
        textSecondary: "#d3c0a6",
        textMuted: "#b29d82",
        accent: "#e4bd84",
        accentSurface: "#493725",
      },
    ).dark,
  },
  rose: {
    light: legacyThemes.rose,
    dark: pair(
      "rose",
      {},
      {
        canvas: "#21161d",
        sidebar: "#2c1b26",
        surface: "#382330",
        surfaceRaised: "#492d3e",
        separator: "#624055",
        accent: "#f0a5c4",
        accentSurface: "#51283e",
      },
    ).dark,
  },
  ocean: {
    light: legacyThemes["ocean-light"],
    dark: pair(
      "ocean",
      {},
      {
        canvas: "#091b24",
        sidebar: "#0c2430",
        surface: "#112e3c",
        surfaceRaised: "#1b3e4e",
        separator: "#2e5564",
        accent: "#83d6de",
        accentSurface: "#184652",
      },
    ).dark,
  },
  cobalt: pair(
    "cobalt",
    {
      canvas: "#f0f4ff",
      sidebar: "#e1e9fa",
      surfaceRaised: "#e5edfc",
      separator: "#c9d7f0",
      accent: "#2852a6",
      accentSurface: "#dce7ff",
    },
    {
      canvas: "#0b1327",
      sidebar: "#101d35",
      surface: "#182847",
      surfaceRaised: "#203659",
      separator: "#304870",
      accent: "#89b4ff",
      accentSurface: "#213962",
    },
  ),
  lavender: pair(
    "lavender",
    {
      canvas: "#f6f3fc",
      sidebar: "#eee6f8",
      surfaceRaised: "#ece4f6",
      separator: "#d8c9ea",
      accent: "#654897",
      accentSurface: "#e9def6",
    },
    {
      canvas: "#191426",
      sidebar: "#221b31",
      surface: "#2d233e",
      surfaceRaised: "#392d4d",
      separator: "#514267",
      accent: "#c4a4ef",
      accentSurface: "#40305a",
    },
  ),
  jade: pair(
    "jade",
    {
      canvas: "#eef9f5",
      sidebar: "#def0e9",
      surfaceRaised: "#deeee8",
      separator: "#bdded1",
      accent: "#18644e",
      accentSurface: "#d5efe4",
    },
    {
      canvas: "#0b1d1b",
      sidebar: "#102822",
      surface: "#16352e",
      surfaceRaised: "#20453a",
      separator: "#30604f",
      accent: "#7bdab5",
      accentSurface: "#1b4a39",
    },
  ),
  amber: pair(
    "amber",
    {
      canvas: "#fdf8eb",
      sidebar: "#f5ecd8",
      surfaceRaised: "#f3e8d0",
      separator: "#e4d5b6",
      accent: "#80520c",
      accentSurface: "#f4e5bd",
    },
    {
      canvas: "#231b0d",
      sidebar: "#2e2412",
      surface: "#382b17",
      surfaceRaised: "#473720",
      separator: "#66502d",
      accent: "#f2c46e",
      accentSurface: "#52401d",
    },
  ),
  slate: pair(
    "slate",
    {
      canvas: "#f0f3f5",
      sidebar: "#e2e8ed",
      surfaceRaised: "#e0e7ec",
      separator: "#c3ced7",
      accent: "#405e72",
      accentSurface: "#dbe7ee",
    },
    {
      canvas: "#141b20",
      sidebar: "#1b252b",
      surface: "#222e36",
      surfaceRaised: "#2d3c45",
      separator: "#40525d",
      accent: "#a5c9d9",
      accentSurface: "#2d4652",
    },
  ),
  sand: pair(
    "sand",
    {
      canvas: "#f9f6ef",
      sidebar: "#f0e9dd",
      surface: "#fffdf7",
      surfaceRaised: "#eee5d7",
      separator: "#ddd0bc",
      accent: "#79612f",
      accentSurface: "#f2e7ce",
    },
    {
      canvas: "#211e19",
      sidebar: "#2a261f",
      surface: "#343027",
      surfaceRaised: "#423b30",
      separator: "#5d5443",
      accent: "#ddc591",
      accentSurface: "#4b412b",
    },
  ),
  tangerine: pair(
    "tangerine",
    {
      canvas: "#fff6f0",
      sidebar: "#f9e8dd",
      surfaceRaised: "#f8e8dc",
      separator: "#e9ccbc",
      accent: "#a3441e",
      accentSurface: "#fae3d4",
    },
    {
      canvas: "#261711",
      sidebar: "#321e17",
      surface: "#40251c",
      surfaceRaised: "#523126",
      separator: "#704637",
      accent: "#f5ab7d",
      accentSurface: "#603526",
    },
  ),
  plum: pair(
    "plum",
    {
      canvas: "#faf2fa",
      sidebar: "#f0e2ef",
      surfaceRaised: "#efdeef",
      separator: "#dfc5dd",
      accent: "#844478",
      accentSurface: "#f4ddf0",
    },
    {
      canvas: "#211423",
      sidebar: "#2b1b2e",
      surface: "#37233b",
      surfaceRaised: "#472e4b",
      separator: "#634268",
      accent: "#e6a3d9",
      accentSurface: "#512e51",
    },
  ),
};

// The old preference stored a single variant under this key. Migrate it locally,
// retaining both the selected palette and its exact light/dark appearance.
export const legacyNames: Record<string, { palette: VitoThemeName; appearance: "light" | "dark" }> =
  {
    "ledger-dark": { palette: "ledger", appearance: "dark" },
    midnight: { palette: "midnight", appearance: "dark" },
    graphite: { palette: "graphite", appearance: "dark" },
    nord: { palette: "nord", appearance: "dark" },
    dracula: { palette: "dracula", appearance: "dark" },
    monokai: { palette: "monokai", appearance: "dark" },
    forest: { palette: "forest", appearance: "dark" },
    espresso: { palette: "espresso", appearance: "dark" },
    oxblood: { palette: "oxblood", appearance: "dark" },
    "solarized-dark": { palette: "solarized", appearance: "dark" },
    paper: { palette: "paper", appearance: "light" },
    "warm-paper": { palette: "warm-paper", appearance: "light" },
    "solarized-light": { palette: "solarized", appearance: "light" },
    rose: { palette: "rose", appearance: "light" },
    "ocean-light": { palette: "ocean", appearance: "light" },
  };

export function resolveThemePreferences(
  savedPalette: string | null,
  savedAppearance: string | null,
  legacy: string | null,
): { palette: VitoThemeName; appearance: ThemeAppearance } {
  const previous = legacy && Object.hasOwn(legacyNames, legacy) ? legacyNames[legacy] : null;
  return {
    palette:
      savedPalette && Object.hasOwn(themes, savedPalette)
        ? (savedPalette as VitoThemeName)
        : (previous?.palette ?? "ledger"),
    appearance:
      savedAppearance === "light" || savedAppearance === "dark" || savedAppearance === "system"
        ? savedAppearance
        : (previous?.appearance ?? "dark"),
  };
}
