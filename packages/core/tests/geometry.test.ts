import { describe, it, expect } from "vitest";
import {
  clamp,
  distance,
  rotatePoint,
  elementCenter,
  elementAABB,
  elementBounds,
  boundsFromPoints,
  unionBounds,
  getElementsBounds,
  pointInBounds,
  boundsIntersect,
  distanceToSegment,
  nanoid,
} from "../src/geometry";
import type { BoardElement, Point } from "../src/types";

describe("geometry", () => {
  describe("clamp", () => {
    it("returns value within range", () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });
    it("clamps to min", () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });
    it("clamps to max", () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });
    it("handles equal min and max", () => {
      expect(clamp(5, 3, 3)).toBe(3);
    });
  });

  describe("distance", () => {
    it("returns 0 for same point", () => {
      expect(distance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
    });
    it("calculates horizontal distance", () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
    });
    it("calculates diagonal distance", () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });
  });

  describe("rotatePoint", () => {
    it("returns same point for angle 0", () => {
      const p = { x: 5, y: 3 };
      const result = rotatePoint(p, { x: 0, y: 0 }, 0);
      expect(result).toEqual({ x: 5, y: 3 });
    });
    it("rotates 90 degrees around origin", () => {
      const result = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });
    it("rotates around custom center", () => {
      const result = rotatePoint({ x: 2, y: 0 }, { x: 1, y: 0 }, Math.PI);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe("elementCenter", () => {
    it("calculates center of element", () => {
      const el = { x: 10, y: 20, width: 100, height: 50 } as BoardElement;
      expect(elementCenter(el)).toEqual({ x: 60, y: 45 });
    });
  });

  describe("elementAABB", () => {
    it("returns axis-aligned bounding box", () => {
      const el = { x: 10, y: 20, width: 100, height: 50 } as BoardElement;
      expect(elementAABB(el)).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
    });
    it("handles negative width/height", () => {
      const el = { x: 10, y: 20, width: -30, height: -10 } as BoardElement;
      const b = elementAABB(el);
      expect(b.minX).toBe(-20);
      expect(b.maxX).toBe(10);
      expect(b.minY).toBe(10);
      expect(b.maxY).toBe(20);
    });
  });

  describe("elementBounds", () => {
    it("returns AABB for unrotated element", () => {
      const el = { x: 0, y: 0, width: 10, height: 10, angle: 0 } as BoardElement;
      expect(elementBounds(el)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    });
    it("expands bounds for rotated element", () => {
      const el = { x: 0, y: 0, width: 10, height: 0, angle: Math.PI / 4 } as BoardElement;
      const b = elementBounds(el);
      // A horizontal line rotated 45deg should have both x and y extent
      expect(b.minY).toBeLessThan(0);
      expect(b.maxY).toBeGreaterThan(0);
    });
  });

  describe("boundsFromPoints", () => {
    it("computes bounding box of points", () => {
      const points: Point[] = [
        { x: -5, y: 2 },
        { x: 10, y: -3 },
        { x: 3, y: 8 },
      ];
      expect(boundsFromPoints(points)).toEqual({ minX: -5, minY: -3, maxX: 10, maxY: 8 });
    });
  });

  describe("unionBounds", () => {
    it("unions two bounds", () => {
      const a = { minX: 0, minY: 0, maxX: 5, maxY: 5 };
      const b = { minX: 3, minY: 3, maxX: 10, maxY: 10 };
      expect(unionBounds(a, b)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    });
  });

  describe("getElementsBounds", () => {
    it("returns null for empty array", () => {
      expect(getElementsBounds([])).toBeNull();
    });
    it("returns bounds of single element", () => {
      const el = { x: 5, y: 5, width: 10, height: 10, angle: 0 } as BoardElement;
      expect(getElementsBounds([el])).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
    });
  });

  describe("pointInBounds", () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

    it("returns true for point inside", () => {
      expect(pointInBounds({ x: 5, y: 5 }, bounds)).toBe(true);
    });
    it("returns false for point outside", () => {
      expect(pointInBounds({ x: 15, y: 5 }, bounds)).toBe(false);
    });
    it("respects padding", () => {
      expect(pointInBounds({ x: 12, y: 5 }, bounds, 3)).toBe(true);
    });
  });

  describe("boundsIntersect", () => {
    it("returns true for overlapping bounds", () => {
      const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      const b = { minX: 5, minY: 5, maxX: 15, maxY: 15 };
      expect(boundsIntersect(a, b)).toBe(true);
    });
    it("returns false for non-overlapping bounds", () => {
      const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      const b = { minX: 20, minY: 20, maxX: 30, maxY: 30 };
      expect(boundsIntersect(a, b)).toBe(false);
    });
  });

  describe("distanceToSegment", () => {
    it("returns 0 for point on segment", () => {
      expect(distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
    });
    it("returns perpendicular distance", () => {
      expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    });
    it("returns distance to nearest endpoint", () => {
      expect(distanceToSegment({ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    });
  });

  describe("nanoid", () => {
    it("returns unique ids", () => {
      const a = nanoid();
      const b = nanoid();
      expect(a).not.toBe(b);
    });
    it("returns string", () => {
      expect(typeof nanoid()).toBe("string");
    });
  });
});
