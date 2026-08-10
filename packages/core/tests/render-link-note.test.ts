import { describe, it, expect } from "vitest";
import { CanvasRenderer } from "../src/CanvasRenderer";
import { createElement } from "../src/elements";
import { THEMES } from "../src/themes";
import type { BoardElement } from "../src/types";

/**
 * These tests exist because of a visible bug: the link icon was drawn with magic
 * factors (`iconeLado * 1.05`) and the arrow escaped its own box — on screen, a
 * crooked icon.
 *
 * You cannot "look at" the canvas in a test, but you can require the invariant
 * that broke: nothing is drawn outside the element bounds, and the expected
 * content (title, preview) does come out. A fake 2D context records every
 * coordinate.
 */
interface Point {
  x: number;
  y: number;
  /** Stroke color at the time of the point: separates the arrow (white) from the rest. */
  stroke?: string;
  /** Point coming from text (fillText), not from a stroke. */
  text?: boolean;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

function fakeCtx() {
  const points: Point[] = [];
  const circles: Circle[] = [];
  const texts: string[] = [];
  const state = { strokeStyle: "" };
  const p = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x, y, stroke: String(state.strokeStyle) });
    }
  };

  const ctx: Record<string, unknown> = {
    // state
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    clip: () => {},
    fill: () => {},
    stroke: () => {},
    setLineDash: () => {},
    scale: () => {},
    translate: () => {},
    setTransform: () => {},
    clearRect: () => {},
    // geometry
    moveTo: p,
    lineTo: p,
    rect: (x: number, y: number, w: number, h: number) => {
      p(x, y);
      p(x + w, y + h);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      p(x, y);
      p(x + w, y + h);
    },
    roundRect: (x: number, y: number, w: number, h: number) => {
      p(x, y);
      p(x + w, y + h);
    },
    arc: (x: number, y: number, r: number) => {
      circles.push({ x, y, r });
      p(x - r, y - r);
      p(x + r, y + r);
    },
    arcTo: (x1: number, y1: number, x2: number, y2: number) => {
      p(x1, y1);
      p(x2, y2);
    },
    ellipse: (x: number, y: number, rx: number, ry: number) => {
      p(x - rx, y - ry);
      p(x + rx, y + ry);
    },
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
      p(cx, cy);
      p(x, y);
    },
    bezierCurveTo: (
      c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number,
    ) => {
      p(c1x, c1y);
      p(c2x, c2y);
      p(x, y);
    },
    // text
    fillText: (t: string, x: number, y: number) => {
      texts.push(t);
      p(x, y);
      // Approximates the text box to check horizontal overflow.
      p(x + t.length * 7, y);
      // Marks the last two as text: the arrow filter ignores text (the
      // strokeStyle in effect during fillText is irrelevant).
      points[points.length - 1].text = true;
      points[points.length - 2].text = true;
    },
    measureText: (t: string) => ({ width: t.length * 7 }),
  };
  // `strokeStyle` is observed: it identifies which points belong to the badge arrow.
  Object.defineProperty(ctx, "strokeStyle", {
    get: () => state.strokeStyle,
    set: (v: string) => {
      state.strokeStyle = v;
    },
  });
  for (const k of [
    "fillStyle", "lineWidth", "globalAlpha", "font", "textBaseline",
    "textAlign", "lineCap", "lineJoin", "shadowColor", "shadowBlur", "shadowOffsetX",
    "shadowOffsetY",
  ]) {
    ctx[k] = "";
  }
  return { ctx, points, circles, texts };
}

function draw(el: BoardElement) {
  const { ctx, points, circles, texts } = fakeCtx();
  const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
  const renderer = new CanvasRenderer(canvas);
  const state = {
    scene: { getElements: () => [el] },
    camera: { zoom: 1, scrollX: 0, scrollY: 0 },
    selectedIds: new Set<string>(),
    background: "#fff",
    grid: false,
    palette: THEMES.light,
  } as never;
  // drawElement is internal: the test exercises the drawing of ONE element.
  (renderer as unknown as { drawElement: (e: BoardElement, s: unknown) => void }).drawElement(
    el,
    state,
  );
  return { points, circles, texts };
}

/** Every drawn point has to fit the element box (with some slack). */
function dentroDaCaixa(el: BoardElement, points: Point[], folga = 4) {
  const fora = points.filter(
    (pt) =>
      pt.x < el.x - folga ||
      pt.x > el.x + el.width + folga ||
      pt.y < el.y - folga ||
      pt.y > el.y + el.height + folga,
  );
  return fora;
}

describe("link drawing", () => {
  const make = (extra: Record<string, unknown> = {}, w = 240, h = 72) =>
    createElement("link", { x: 100, y: 200, width: w, height: h, ...extra } as never);

  it("draws nothing outside the card", () => {
    const el = make({ targetId: "b2", label: "Arquitetura", subtitle: "board" });
    const { points } = draw(el);
    expect(points.length).toBeGreaterThan(5);
    expect(dentroDaCaixa(el, points)).toEqual([]);
  });

  it("stays inside the box at extreme sizes", () => {
    for (const [w, h] of [[60, 24], [1000, 300], [90, 200]] as [number, number][]) {
      const el = make({ targetId: "b", label: "A really long board name" }, w, h);
      const { points } = draw(el);
      expect(dentroDaCaixa(el, points), `${w}x${h}`).toEqual([]);
    }
  });

  it("shows the destination name", () => {
    const { texts } = draw(make({ targetId: "b2", label: "Arquitetura" }));
    expect(texts.join(" ")).toContain("Arquitetura");
  });

  it("with no destination, invites you to pick one", () => {
    const { texts } = draw(make());
    expect(texts.join(" ")).toMatch(/choose a board/i);
  });

  /**
   * The reported bug ("icon all crooked"): the arrow was drawn with magic factors
   * and left the icon's own box. Now it comes from the badge center + radius, so
   * it has to fit INSIDE the circle — an invariant the old drawing violated.
   */
  it("the arrow fits inside the round badge", () => {
    for (const [w, h] of [[240, 72], [90, 40], [600, 200]] as [number, number][]) {
      const el = make({ targetId: "b", label: "Board" }, w, h);
      const { points, circles } = draw(el);

      expect(circles.length, `${w}x${h}: badge not drawn`).toBe(1);
      const badge = circles[0];
      // The arrow is the only white stroke on the card (text does not count).
      const arrow = points.filter((pt) => pt.stroke === "#ffffff" && !pt.text);
      expect(arrow.length, `${w}x${h}: arrow not drawn`).toBeGreaterThan(2);

      for (const pt of arrow) {
        const d = Math.hypot(pt.x - badge.x, pt.y - badge.y);
        expect(d, `${w}x${h}: point (${pt.x},${pt.y}) outside the badge`).toBeLessThanOrEqual(badge.r);
      }
    }
  });

  it("the badge fits inside the card", () => {
    const el = make({ targetId: "b", label: "Board" });
    const { circles } = draw(el);
    const badge = circles[0];
    expect(badge.x - badge.r).toBeGreaterThanOrEqual(el.x);
    expect(badge.x + badge.r).toBeLessThanOrEqual(el.x + el.width);
    expect(badge.y - badge.r).toBeGreaterThanOrEqual(el.y);
    expect(badge.y + badge.r).toBeLessThanOrEqual(el.y + el.height);
  });
});

describe("note drawing", () => {
  const make = (extra: Record<string, unknown> = {}, w = 260, h = 200) =>
    createElement("note", { x: -50, y: 40, width: w, height: h, ...extra } as never);

  it("draws nothing outside the card", () => {
    const el = make({ title: "Ata", text: "primeira linha\nsegunda linha" });
    const { points } = draw(el);
    expect(points.length).toBeGreaterThan(5);
    expect(dentroDaCaixa(el, points)).toEqual([]);
  });

  it("long text does not overflow the card", () => {
    const el = make({ title: "Meeting", text: "word ".repeat(400) });
    const { points } = draw(el);
    expect(dentroDaCaixa(el, points)).toEqual([]);
  });

  it("a small card does not turn into graphic garbage", () => {
    const el = make({ title: "x", text: "y" }, 70, 40);
    const { points } = draw(el);
    expect(dentroDaCaixa(el, points)).toEqual([]);
  });

  it("shows the title and the text preview", () => {
    const { texts } = draw(make({ title: "Ata", text: "decidimos algo" }));
    const tudo = texts.join(" ");
    expect(tudo).toContain("Ata");
    expect(tudo).toContain("decidimos");
  });

  it("an empty note explains what to do", () => {
    const { texts } = draw(make());
    expect(texts.join(" ")).toMatch(/double-click/i);
  });

  it("does not draw the centered label over its own content", () => {
    // `label` is the mechanism of the other elements; note/link draw their own
    // content and must not duplicate text in the middle of the card.
    const { texts } = draw(make({ title: "Minutes", text: "body", label: "MUST_NOT_RENDER" }));
    expect(texts.join(" ")).not.toContain("NAO_DEVE_SAIR");
  });
});
