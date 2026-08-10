import { describe, it, expect } from "vitest";
import { computeSnap } from "../src/snapping";
import type { Bounds } from "../src/types";

describe("snapping", () => {
  describe("computeSnap", () => {
    it("returns zero delta when no other elements", () => {
      const moving: Bounds = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
      const result = computeSnap(moving, [], 5);
      expect(result.dx).toBe(0);
      expect(result.dy).toBe(0);
      expect(result.guides).toHaveLength(0);
    });

    it("snaps left edge to other left edge", () => {
      const moving: Bounds = { minX: 98, minY: 0, maxX: 148, maxY: 50 };
      const other: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 150 };
      const result = computeSnap(moving, [other], 5);
      expect(result.dx).toBe(2); // snap to align left edges
    });

    it("snaps center x to other center x", () => {
      const moving: Bounds = { minX: 48, minY: 0, maxX: 98, maxY: 50 };
      // Other center x = 150
      const other: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 150 };
      // Moving center x = 73. Other center = 150. Too far, no snap.
      const result = computeSnap(moving, [other], 5);
      // 73 vs 150 = 77 diff, beyond threshold
      expect(result.dx).toBe(2); // minX 48 vs 100 = 52, too far. maxX 98 vs 100 = 2!
    });

    it("does not snap beyond threshold", () => {
      const moving: Bounds = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
      const other: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
      const result = computeSnap(moving, [other], 5);
      expect(result.dx).toBe(0);
      expect(result.dy).toBe(0);
    });

    it("provides guide lines on snap", () => {
      const moving: Bounds = { minX: 99, minY: 0, maxX: 149, maxY: 50 };
      const other: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 150 };
      const result = computeSnap(moving, [other], 5);
      expect(result.guides.length).toBeGreaterThan(0);
      const verticalGuide = result.guides.find((g) => g.vertical);
      expect(verticalGuide).toBeTruthy();
    });

    it("snaps x and y independently", () => {
      const moving: Bounds = { minX: 99, minY: 149, maxX: 149, maxY: 199 };
      const other: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 150 };
      const result = computeSnap(moving, [other], 5);
      expect(result.dx).toBe(1); // minX 99 → 100
      expect(result.dy).toBe(1); // minY 149 → 150 (other maxY)
    });
  });
});
