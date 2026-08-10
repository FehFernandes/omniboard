// Template registry: sets of elements already assembled and positioned.
//
// The list is EMPTY on purpose — the infrastructure is ready and the content
// comes later. To add an item, just push a {@link Template} into TEMPLATES: the
// tab in the toolbar populates itself, grouped by `group`, and the insertion
// (single undo step, centered in the viewport, already selected) is already
// solved in board-app.
//
// A template is a PURE function: it takes the anchor (top-left corner) and
// returns the elements with coordinates relative to it. No state, no canvas —
// the geometry can be tested without booting the application.
import type { BoardElement } from '@omniboard/react';

export interface TemplateContext {
  /** Top-left corner where the set will be placed (world coordinates). */
  x: number;
  y: number;
}

export type TemplateGroup = 'Cards' | 'Diagrams' | 'Collaboration' | 'Planning';

export interface Template {
  id: string;
  /** Name shown in the UI. */
  name: string;
  /** One line explaining what it is for. */
  hint: string;
  /** Category used to group it in the list. */
  group: TemplateGroup;
  /**
   * Builds the elements. It must generate new ids on every call (use the core's
   * `createElement`) so inserting the same template twice does not collide.
   */
  build(ctx: TemplateContext): BoardElement[];
}

/** Order of the sections in the panel. */
export const TEMPLATE_GROUPS: TemplateGroup[] = [
  'Cards',
  'Diagrams',
  'Planning',
  'Collaboration',
];

export const TEMPLATES: Template[] = [];

/** Templates grouped, in the order they show up in the UI. Empty groups drop. */
export function templatesByGroup(): [TemplateGroup, Template[]][] {
  return TEMPLATE_GROUPS.map(
    (g) => [g, TEMPLATES.filter((t) => t.group === g)] as [TemplateGroup, Template[]],
  ).filter(([, list]) => list.length > 0);
}

/** Width/height the template occupies (used to center it in the viewport). */
export function templateSize(t: Template): { width: number; height: number } {
  const els = t.build({ x: 0, y: 0 });
  let maxX = 0;
  let maxY = 0;
  for (const e of els) {
    maxX = Math.max(maxX, e.x + Math.abs(e.width));
    maxY = Math.max(maxY, e.y + Math.abs(e.height));
  }
  return { width: maxX, height: maxY };
}
