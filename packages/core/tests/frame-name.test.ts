import { describe, it, expect } from "vitest";
import {
  FRAME_NAME_FONT_SIZE,
  FRAME_NAME_GAP,
  frameNameHitBox,
  frameNameOrigin,
} from "../src/geometry";
import { createElement, hitTestElement } from "../src/elements";
import type { FrameElement } from "../src/types";

const makeFrame = (title = "Sprint 12"): FrameElement =>
  createElement("frame", { x: 100, y: 200, width: 400, height: 300, title } as never) as FrameElement;

describe("frame name", () => {
  it("sits on the LEFT, above the border", () => {
    const f = makeFrame();
    const o = frameNameOrigin(f);
    expect(o.x).toBe(f.x); // left-aligned, not right-aligned
    expect(o.y).toBe(f.y - FRAME_NAME_GAP);
    expect(o.y).toBeLessThan(f.y); // outside the frame, above
  });

  it("frame is born with a default name (the label must be discoverable)", () => {
    const f = createElement("frame", { x: 0, y: 0, width: 300, height: 200 }) as FrameElement;
    expect(f.title).toBe("Frame");
  });

  it("the name strip is clickable: it sits above the border, to the left", () => {
    const f = makeFrame();
    const faixa = frameNameHitBox(f)!;
    expect(faixa.minX).toBe(f.x);
    expect(faixa.maxY).toBe(f.y);
    expect(faixa.minY).toBeLessThan(f.y);
    expect(faixa.maxX).toBeGreaterThan(f.x);
    // Does not go past the frame width.
    expect(faixa.maxX).toBeLessThanOrEqual(f.x + f.width);
  });

  /**
   * Regression from the report "it isn't easily editable": the name is drawn
   * OUTSIDE the rectangle, so clicking it did not hit the frame — neither to
   * select it, nor for the double click that renames it.
   */
  it("clicking the name hits the frame", () => {
    const f = makeFrame();
    const noNome = { x: f.x + 10, y: f.y - FRAME_NAME_GAP - 2 };
    expect(hitTestElement(f, noNome)).toBe(true);
    // Inside the frame still hits.
    expect(hitTestElement(f, { x: f.x + 50, y: f.y + 50 })).toBe(true);
  });

  it("with no name there is no invisible click area", () => {
    const f = { ...makeFrame(""), title: "", label: undefined };
    expect(frameNameHitBox(f)).toBeNull();
    expect(hitTestElement(f, { x: f.x + 10, y: f.y - FRAME_NAME_GAP - 2 })).toBe(false);
  });

  it("accepts `label` from frames saved before the name editor", () => {
    const f = { ...makeFrame(""), title: "", label: "Old" };
    expect(frameNameHitBox(f)).not.toBeNull();
  });

  it("strip follows the text size, capped at the frame width", () => {
    const short = frameNameHitBox(makeFrame("A"))!;
    const long = frameNameHitBox(makeFrame("A considerably longer name"))!;
    expect(long.maxX - long.minX).toBeGreaterThan(short.maxX - short.minX);

    const narrow = frameNameHitBox({
      x: 0,
      y: 0,
      width: 60,
      title: "A name considerably longer than the frame",
    })!;
    expect(narrow.maxX - narrow.minX).toBeLessThanOrEqual(60);
  });

  it("strip height covers the text line", () => {
    const f = makeFrame();
    const faixa = frameNameHitBox(f)!;
    expect(faixa.maxY - faixa.minY).toBeGreaterThanOrEqual(FRAME_NAME_FONT_SIZE);
  });
});
