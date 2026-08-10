import { describe, it, expect, beforeEach } from "vitest";
import { Scene } from "../src/Scene";
import { createElement } from "../src/elements";
import type { BoardElement } from "../src/types";

describe("Scene", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  describe("constructor", () => {
    it("starts empty", () => {
      expect(scene.size).toBe(0);
      expect(scene.getElements()).toEqual([]);
    });

    it("accepts initial elements", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      const s = new Scene([el]);
      expect(s.size).toBe(1);
      expect(s.getElement(el.id)).toBe(el);
    });
  });

  describe("add", () => {
    it("adds an element", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      expect(scene.size).toBe(1);
      expect(scene.getElement(el.id)).toBe(el);
    });

    it("does not duplicate on re-add of same id", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      scene.add({ ...el, width: 20 } as BoardElement);
      expect(scene.size).toBe(1);
    });
  });

  describe("addMany", () => {
    it("adds multiple elements", () => {
      const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      const b = createElement("ellipse", { x: 20, y: 20, width: 30, height: 30 });
      scene.addMany([a, b]);
      expect(scene.size).toBe(2);
    });
  });

  describe("update", () => {
    it("updates element properties", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      const updated = scene.update(el.id, { width: 50 });
      expect(updated?.width).toBe(50);
      expect(updated?.version).toBeGreaterThan(el.version);
    });

    it("returns undefined for non-existent id", () => {
      expect(scene.update("fake-id", { width: 50 })).toBeUndefined();
    });
  });

  describe("remove (soft delete)", () => {
    it("marks element as deleted", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      scene.remove(el.id);
      expect(scene.getElement(el.id)?.isDeleted).toBe(true);
    });

    it("excludes deleted elements from getElements()", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      scene.remove(el.id);
      expect(scene.getElements()).toHaveLength(0);
    });

    it("includes deleted elements in getAllRaw()", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      scene.remove(el.id);
      expect(scene.getAllRaw()).toHaveLength(1);
    });
  });

  describe("removeMany", () => {
    it("removes multiple elements", () => {
      const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      const b = createElement("ellipse", { x: 20, y: 20, width: 30, height: 30 });
      scene.addMany([a, b]);
      scene.removeMany([a.id, b.id]);
      expect(scene.getElements()).toHaveLength(0);
    });
  });

  describe("z-order", () => {
    it("maintains insertion order", () => {
      const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      const b = createElement("ellipse", { x: 20, y: 20, width: 30, height: 30 });
      const c = createElement("rectangle", { x: 40, y: 40, width: 10, height: 10 });
      scene.addMany([a, b, c]);
      const els = scene.getElements();
      expect(els[0].id).toBe(a.id);
      expect(els[1].id).toBe(b.id);
      expect(els[2].id).toBe(c.id);
    });

    it("bringToFront moves element to end", () => {
      const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      const b = createElement("ellipse", { x: 20, y: 20, width: 30, height: 30 });
      scene.addMany([a, b]);
      scene.bringToFront(a.id);
      const els = scene.getElements();
      expect(els[0].id).toBe(b.id);
      expect(els[1].id).toBe(a.id);
    });

    it("sendToBack moves element to start", () => {
      const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      const b = createElement("ellipse", { x: 20, y: 20, width: 30, height: 30 });
      scene.addMany([a, b]);
      scene.sendToBack(b.id);
      const els = scene.getElements();
      expect(els[0].id).toBe(b.id);
      expect(els[1].id).toBe(a.id);
    });
  });

  describe("replaceAll", () => {
    it("replaces all elements", () => {
      const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(a);
      const b = createElement("ellipse", { x: 20, y: 20, width: 30, height: 30 });
      scene.replaceAll([b]);
      expect(scene.size).toBe(1);
      expect(scene.getElement(a.id)).toBeUndefined();
      expect(scene.getElement(b.id)).toBe(b);
    });
  });

  describe("clear", () => {
    it("removes all elements", () => {
      const a = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(a);
      scene.clear();
      expect(scene.size).toBe(0);
      expect(scene.getElements()).toEqual([]);
    });
  });
});
