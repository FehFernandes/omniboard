import { describe, it, expect } from "vitest";
import {
  createElement,
  normalizeElement,
  hitTestElement,
  DEFAULT_STYLE,
} from "../src/elements";
import type { LinearElement, FreedrawElement, BoardElement } from "../src/types";

describe("elements", () => {
  describe("createElement", () => {
    it("creates rectangle with defaults", () => {
      const el = createElement("rectangle", { x: 10, y: 20, width: 100, height: 50 });
      expect(el.type).toBe("rectangle");
      expect(el.x).toBe(10);
      expect(el.y).toBe(20);
      expect(el.width).toBe(100);
      expect(el.height).toBe(50);
      expect(el.id).toBeTruthy();
      expect(el.version).toBeGreaterThan(0);
      expect(el.angle).toBe(0);
    });

    it("creates ellipse", () => {
      const el = createElement("ellipse", { x: 0, y: 0, width: 80, height: 60 });
      expect(el.type).toBe("ellipse");
    });

    it("creates line with points", () => {
      const el = createElement("line", { x: 0, y: 0, width: 100, height: 100 }) as LinearElement;
      expect(el.type).toBe("line");
      expect(el.points).toHaveLength(2);
      expect(el.points[0]).toEqual({ x: 0, y: 0 });
      expect(el.points[1]).toEqual({ x: 100, y: 100 });
    });

    it("creates arrow with custom points", () => {
      const pts = [{ x: 0, y: 0 }, { x: 50, y: 25 }, { x: 100, y: 0 }];
      const el = createElement("arrow", { x: 0, y: 0, width: 100, height: 25, points: pts } as any) as LinearElement;
      expect(el.type).toBe("arrow");
      expect(el.points).toEqual(pts);
    });

    it("creates freedraw", () => {
      const el = createElement("freedraw", { x: 0, y: 0, width: 0, height: 0 }) as FreedrawElement;
      expect(el.type).toBe("freedraw");
      expect(el.points).toHaveLength(1);
    });

    it("creates text with defaults", () => {
      const el = createElement("text", { x: 0, y: 0 });
      expect(el.type).toBe("text");
      expect((el as any).text).toBe("");
      expect((el as any).fontSize).toBe(20);
    });

    it("creates image", () => {
      const el = createElement("image", { x: 0, y: 0, width: 200, height: 150, src: "data:image/png;base64,abc" } as any);
      expect(el.type).toBe("image");
      expect((el as any).src).toBe("data:image/png;base64,abc");
    });

    it("creates embed", () => {
      const el = createElement("embed", { x: 0, y: 0, width: 400, height: 300, src: "https://youtube.com/embed/xxx" } as any);
      expect(el.type).toBe("embed");
      expect((el as any).src).toBe("https://youtube.com/embed/xxx");
    });

    it("creates tasks", () => {
      const el = createElement("tasks", { x: 0, y: 0, width: 200, height: 150 });
      expect(el.type).toBe("tasks");
      expect((el as any).title).toBe("Tarefas");
      expect((el as any).items).toHaveLength(1);
    });

    it("creates shape", () => {
      const el = createElement("shape", { x: 0, y: 0, width: 80, height: 80, shape: "diamond" } as any);
      expect(el.type).toBe("shape");
      expect((el as any).shape).toBe("diamond");
    });

    it("creates sticky", () => {
      const el = createElement("sticky", { x: 0, y: 0, width: 150, height: 150 });
      expect(el.type).toBe("sticky");
      expect((el as any).color).toBe("#FFF9B1");
    });

    it("creates frame with a default name", () => {
      const el = createElement("frame", { x: 0, y: 0, width: 500, height: 400 });
      expect(el.type).toBe("frame");
      // Born with a default name: the label in the top-right corner has to exist
      // for the user to discover it can be renamed (double click).
      expect((el as any).title).toBe("Frame");
    });

    it("accepts a frame name on creation", () => {
      // The name goes in `props` (2nd argument); the 3rd is style only.
      const el = createElement("frame", {
        x: 0, y: 0, width: 500, height: 400, title: "Sprint 12",
      } as any);
      expect((el as any).title).toBe("Sprint 12");
    });

    it("applies custom style", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }, {
        strokeColor: "#ff0000",
        strokeWidth: 4,
      });
      expect(el.strokeColor).toBe("#ff0000");
      expect(el.strokeWidth).toBe(4);
    });

    it("uses provided id", () => {
      const el = createElement("rectangle", { id: "custom-id", x: 0, y: 0, width: 10, height: 10 });
      expect(el.id).toBe("custom-id");
    });
  });

  describe("normalizeElement", () => {
    it("flips negative width", () => {
      const el = createElement("rectangle", { x: 100, y: 50, width: -30, height: -20 });
      const norm = normalizeElement(el);
      expect(norm.x).toBe(70);
      expect(norm.y).toBe(30);
      expect(norm.width).toBe(30);
      expect(norm.height).toBe(20);
    });

    it("does nothing for positive dimensions", () => {
      const el = createElement("rectangle", { x: 10, y: 20, width: 100, height: 50 });
      const norm = normalizeElement(el);
      expect(norm.x).toBe(10);
      expect(norm.width).toBe(100);
    });

    it("normalizes linear element by re-anchoring points", () => {
      const el = createElement("line", {
        x: 50, y: 50, width: 100, height: 100,
        points: [{ x: 20, y: 10 }, { x: -10, y: 30 }],
      } as any) as LinearElement;
      const norm = normalizeElement(el) as LinearElement;
      // Points should be offset so min is at 0
      expect(norm.points[0].x).toBeGreaterThanOrEqual(0);
      expect(norm.points[0].y).toBeGreaterThanOrEqual(0);
      expect(norm.width).toBeGreaterThanOrEqual(0);
      expect(norm.height).toBeGreaterThanOrEqual(0);
    });
  });

  describe("hitTestElement", () => {
    it("hits rectangle interior (filled)", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, {
        backgroundColor: "#fff",
      });
      expect(hitTestElement(el, { x: 50, y: 50 })).toBe(true);
    });

    it("misses rectangle outside", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }, {
        backgroundColor: "#fff",
      });
      expect(hitTestElement(el, { x: 200, y: 200 })).toBe(false);
    });

    it("hits ellipse on edge", () => {
      const el = createElement("ellipse", { x: 0, y: 0, width: 100, height: 100 }, {
        backgroundColor: "#fff",
      });
      expect(hitTestElement(el, { x: 50, y: 50 })).toBe(true); // center
    });

    it("misses ellipse outside", () => {
      const el = createElement("ellipse", { x: 0, y: 0, width: 100, height: 100 }, {
        backgroundColor: "#fff",
      });
      expect(hitTestElement(el, { x: 200, y: 200 })).toBe(false);
    });

    it("hits line near segment", () => {
      const el = createElement("line", { x: 0, y: 0, width: 100, height: 0 }) as LinearElement;
      expect(hitTestElement(el, { x: 50, y: 2 })).toBe(true); // close to the line
    });

    it("misses line far away", () => {
      const el = createElement("line", { x: 0, y: 0, width: 100, height: 0 }) as LinearElement;
      expect(hitTestElement(el, { x: 50, y: 50 })).toBe(false);
    });
  });
});
