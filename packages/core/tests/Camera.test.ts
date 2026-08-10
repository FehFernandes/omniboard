import { describe, it, expect, beforeEach } from "vitest";
import { Camera } from "../src/Camera";

describe("Camera", () => {
  let camera: Camera;

  beforeEach(() => {
    camera = new Camera();
  });

  describe("constructor", () => {
    it("defaults to origin with zoom 1", () => {
      expect(camera.scrollX).toBe(0);
      expect(camera.scrollY).toBe(0);
      expect(camera.zoom).toBe(1);
    });

    it("accepts initial state", () => {
      const c = new Camera({ scrollX: 10, scrollY: 20, zoom: 2 });
      expect(c.scrollX).toBe(10);
      expect(c.scrollY).toBe(20);
      expect(c.zoom).toBe(2);
    });

    it("accepts min/max zoom", () => {
      const c = new Camera({}, 0.5, 5);
      expect(c.minZoom).toBe(0.5);
      expect(c.maxZoom).toBe(5);
    });
  });

  describe("getState / setState", () => {
    it("returns current state", () => {
      camera.scrollX = 5;
      camera.scrollY = 10;
      camera.zoom = 2;
      expect(camera.getState()).toEqual({ scrollX: 5, scrollY: 10, zoom: 2 });
    });

    it("sets partial state", () => {
      camera.setState({ zoom: 3 });
      expect(camera.zoom).toBe(3);
      expect(camera.scrollX).toBe(0);
    });

    it("clamps zoom to bounds", () => {
      camera.setState({ zoom: 100 });
      expect(camera.zoom).toBe(camera.maxZoom);
      camera.setState({ zoom: 0.001 });
      expect(camera.zoom).toBe(camera.minZoom);
    });
  });

  describe("screenToWorld / worldToScreen", () => {
    it("identity at default state", () => {
      expect(camera.screenToWorld(100, 200)).toEqual({ x: 100, y: 200 });
      expect(camera.worldToScreen(100, 200)).toEqual({ x: 100, y: 200 });
    });

    it("accounts for zoom", () => {
      camera.zoom = 2;
      const world = camera.screenToWorld(100, 200);
      expect(world).toEqual({ x: 50, y: 100 });
    });

    it("accounts for scroll", () => {
      camera.scrollX = 50;
      camera.scrollY = 30;
      const screen = camera.worldToScreen(10, 10);
      expect(screen).toEqual({ x: 60, y: 40 });
    });

    it("roundtrips correctly", () => {
      camera.scrollX = 33;
      camera.scrollY = -17;
      camera.zoom = 1.5;
      const world = camera.screenToWorld(150, 200);
      const screen = camera.worldToScreen(world.x, world.y);
      expect(screen.x).toBeCloseTo(150);
      expect(screen.y).toBeCloseTo(200);
    });
  });

  describe("panBy", () => {
    it("adjusts scroll by screen delta / zoom", () => {
      camera.zoom = 2;
      camera.panBy(10, 20);
      expect(camera.scrollX).toBe(5);
      expect(camera.scrollY).toBe(10);
    });
  });

  describe("zoomTo", () => {
    it("changes zoom level", () => {
      camera.zoomTo(2, { x: 0, y: 0 });
      expect(camera.zoom).toBe(2);
    });

    it("clamps zoom", () => {
      camera.zoomTo(999, { x: 0, y: 0 });
      expect(camera.zoom).toBe(camera.maxZoom);
    });

    it("keeps anchor point stationary in world space", () => {
      const anchor = { x: 100, y: 100 };
      const worldBefore = camera.screenToWorld(anchor.x, anchor.y);
      camera.zoomTo(2, anchor);
      const worldAfter = camera.screenToWorld(anchor.x, anchor.y);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y);
    });
  });

  describe("zoomBy", () => {
    it("multiplies current zoom", () => {
      camera.zoomBy(2, { x: 0, y: 0 });
      expect(camera.zoom).toBe(2);
      camera.zoomBy(0.5, { x: 0, y: 0 });
      expect(camera.zoom).toBeCloseTo(1);
    });
  });
});
