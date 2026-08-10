/**
 * Inline SVG icon set used by the built-in UI (toolbar, overlays) and available
 * to consumers via `import { ICONS } from "@omniboard/core"`.
 *
 * Icons are from **Feather Icons** (https://feathericons.com) — MIT licensed,
 * also distributed on SVG Repo:
 * https://www.svgrepo.com/collection/feather-interface-icons/
 *
 * All icons use `stroke="currentColor"` (or `fill="currentColor"` when solid),
 * so they automatically inherit the surrounding text/button color and theme.
 */

function line(paths: string, solid = false): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" ` +
    `viewBox="0 0 24 24" fill="${solid ? "currentColor" : "none"}" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`
  );
}

export const ICONS: Record<string, string> = {
  // Tools
  cursor: line(
    `<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>`,
  ),
  hand: line(
    `<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>` +
      `<polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>` +
      `<line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>`,
  ),
  rectangle: line(`<rect x="3" y="4" width="18" height="16" rx="2" ry="2"/>`),
  ellipse: line(`<circle cx="12" cy="12" r="9"/>`),
  diagonal: line(`<line x1="5" y1="19" x2="19" y2="5"/>`),
  arrowRight: line(
    `<line x1="4" y1="12" x2="20" y2="12"/><polyline points="13 5 20 12 13 19"/>`,
  ),
  pencil: line(`<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>`),
  text: line(
    `<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/>` +
      `<line x1="12" y1="4" x2="12" y2="20"/>`,
  ),
  image: line(
    `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>` +
      `<circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`,
  ),
  globe: line(
    `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>` +
      `<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  ),

  // Theme
  moon: line(`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`),
  sun: line(
    `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>` +
      `<line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>` +
      `<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>` +
      `<line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>` +
      `<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`,
  ),

  // Actions
  copy: line(
    `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>` +
      `<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
  ),
  clipboard: line(
    `<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>` +
      `<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>`,
  ),
  trash: line(
    `<polyline points="3 6 5 6 21 6"/>` +
      `<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>` +
      `<line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>`,
  ),
  bringForward: line(
    `<polyline points="6 9 12 3 18 9"/><line x1="12" y1="3" x2="12" y2="15"/>`,
  ),
  sendBackward: line(
    `<polyline points="6 15 12 21 18 15"/><line x1="12" y1="9" x2="12" y2="21"/>`,
  ),
  undo: line(
    `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`,
  ),
  redo: line(
    `<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>`,
  ),
  maximize: line(
    `<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>`,
  ),
  download: line(
    `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>` +
      `<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  ),
  upload: line(
    `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>` +
      `<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
  ),
  play: line(`<polygon points="6 4 20 12 6 20 6 4"/>`, true),
  close: line(
    `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  ),
  edit: line(
    `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>` +
      `<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  ),
  grid: line(
    `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>` +
      `<rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`,
  ),
  eraser: line(
    `<path d="M20 20H7L3 16a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-7 8"/>`,
  ),
  lock: line(
    `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>` +
      `<path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  ),
  unlock: line(
    `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>` +
      `<path d="M7 11V7a5 5 0 0 1 9.9-1"/>`,
  ),
};
