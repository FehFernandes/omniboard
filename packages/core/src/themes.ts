export type Theme = "light" | "dark";

export interface ThemePalette {
  /** Canvas background. */
  background: string;
  /** Dotted grid color (with alpha). */
  grid: string;
  /** Default stroke color for new elements. */
  defaultStroke: string;
  /** Selection outline / handles color. */
  selection: string;
  /** Selection box fill (with alpha). */
  selectionFill: string;
}

export const THEMES: Record<Theme, ThemePalette> = {
  light: {
    background: "#ffffff",
    grid: "#00000014",
    defaultStroke: "#1e1e1e",
    selection: "#6965db",
    selectionFill: "#6965db14",
  },
  dark: {
    background: "#121212",
    grid: "#ffffff14",
    defaultStroke: "#e3e3e3",
    selection: "#a8a5ff",
    selectionFill: "#a8a5ff1f",
  },
};
