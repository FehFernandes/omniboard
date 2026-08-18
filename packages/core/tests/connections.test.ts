import { describe, it, expect } from "vitest";
import {
  ANCHOR_GRAB_RADIUS,
  ANCHOR_HANDLE_GAP,
  ANCHOR_ZONE_PADDING,
  findAnchorHost,
  getElementAnchorHandles,
  isConnectable,
} from "../src/connections";
import { createElement } from "../src/elements";
import type { BoardElement } from "../src/types";

const retangulo = (x: number, y: number, w = 100, h = 80): BoardElement =>
  createElement("rectangle", { x, y, width: w, height: h });

describe("connection anchors", () => {
  it("the dots sit OUTSIDE the border", () => {
    const el = retangulo(0, 0);
    const zoom = 1;
    const handles = getElementAnchorHandles(el, zoom);
    const direita = handles.find((h) => h.anchor === "right")!;
    // `attach` on the border, `point` (what gets clicked) pushed outwards.
    expect(direita.attach.x).toBe(100);
    expect(direita.point.x).toBe(100 + ANCHOR_HANDLE_GAP);
  });

  it("shows the anchors of the element under the cursor", () => {
    const el = retangulo(0, 0);
    expect(findAnchorHost({ x: 50, y: 40 }, [el], 1, el)?.id).toBe(el.id);
  });

  /**
   * Regression from the report "can't pull the arrow": the dots sit 13px outside
   * the element, but only showed up with the cursor INSIDE it — they vanished
   * halfway to the dot.
   */
  it("keeps the anchors when the cursor leaves the element towards the dot", () => {
    const el = retangulo(0, 0);
    // On the right-hand dot (outside the element, no hit).
    const naBolinha = { x: 100 + ANCHOR_HANDLE_GAP, y: 40 };
    expect(findAnchorHost(naBolinha, [el], 1, null)?.id).toBe(el.id);

    // The dot must be within the click radius from that point.
    const handles = getElementAnchorHandles(el, 1);
    const direita = handles.find((h) => h.anchor === "right")!;
    const dist = Math.hypot(direita.point.x - naBolinha.x, direita.point.y - naBolinha.y);
    expect(dist).toBeLessThanOrEqual(ANCHOR_GRAB_RADIUS);
  });

  it("disappears when the cursor is far from the element", () => {
    const el = retangulo(0, 0);
    const longe = { x: 100 + ANCHOR_HANDLE_GAP + ANCHOR_ZONE_PADDING + 5, y: 40 };
    expect(findAnchorHost(longe, [el], 1, null)).toBeNull();
  });

  it("zone follows the zoom (in screen px, not world px)", () => {
    const el = retangulo(0, 0);
    // With zoom 2, the same screen distance is worth half in world units.
    const worldPoint = { x: 100 + (ANCHOR_HANDLE_GAP + ANCHOR_ZONE_PADDING) / 2 - 1, y: 40 };
    expect(findAnchorHost(worldPoint, [el], 2, null)?.id).toBe(el.id);
    const foraComZoom2 = { x: 100 + ANCHOR_HANDLE_GAP + ANCHOR_ZONE_PADDING, y: 40 };
    expect(findAnchorHost(foraComZoom2, [el], 2, null)).toBeNull();
  });

  it("prefers the topmost element when the zones overlap", () => {
    const baixo = retangulo(0, 0);
    const cima = retangulo(120, 0);
    // Point between the two: it belongs to both zones; the last in the list wins.
    const middle = { x: 110, y: 40 };
    expect(findAnchorHost(middle, [baixo, cima], 1, null)?.id).toBe(cima.id);
  });

  it("does not anchor to arrow, line, freedraw or text", () => {
    const arrow = createElement("arrow", {
      x: 0, y: 0, width: 50, height: 0,
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
    } as never);
    const text = createElement("text", { x: 0, y: 0, width: 40, height: 20 });
    expect(isConnectable(arrow)).toBe(false);
    expect(isConnectable(text)).toBe(false);
    expect(findAnchorHost({ x: 10, y: 0 }, [arrow, text], 1, null)).toBeNull();
    expect(isConnectable(retangulo(0, 0))).toBe(true);
  });

  it("ignores deleted elements", () => {
    const el = { ...retangulo(0, 0), isDeleted: true };
    expect(findAnchorHost({ x: 50, y: 40 }, [el], 1, null)).toBeNull();
  });
});
