// Streets basemap per colour scheme.

export type Mode = "light" | "dark";

export const MAP_STYLE: Record<Mode, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export const currentMode = (): Mode =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
