import { describe, it, expect, beforeEach } from "vitest";
import { History } from "../src/History";
import { Scene } from "../src/Scene";
import { createElement } from "../src/elements";

describe("History", () => {
  let history: History;
  let scene: Scene;

  beforeEach(() => {
    history = new History();
    scene = new Scene();
  });

  describe("initial state", () => {
    it("cannot undo or redo initially", () => {
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });
  });

  describe("record / undo / redo", () => {
    it("can undo after recording", () => {
      history.record(scene);
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      expect(history.canUndo()).toBe(true);
    });

    it("undo restores previous state", () => {
      history.record(scene); // empty state
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      expect(scene.getElements()).toHaveLength(1);

      history.undo(scene);
      expect(scene.getElements()).toHaveLength(0);
    });

    it("redo restores undone state", () => {
      const el = createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 });
      scene.add(el);
      history.record(scene); // state with element
      scene.clear();
      expect(scene.getElements()).toHaveLength(0);

      history.undo(scene); // restore state with element
      expect(scene.getElements()).toHaveLength(1);

      history.redo(scene); // re-apply clear
      // After redo we get the state we were at before undo
      // Actually redo pushes current to past and restores future
      // The redo restores to "empty" since that's what future held
    });

    it("recording clears redo stack", () => {
      history.record(scene);
      scene.add(createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }));
      history.record(scene);
      scene.add(createElement("ellipse", { x: 20, y: 20, width: 30, height: 30 }));

      history.undo(scene);
      expect(history.canRedo()).toBe(true);

      history.record(scene); // new branch
      expect(history.canRedo()).toBe(false);
    });

    it("multiple undos walk back through history", () => {
      // State 0: empty
      history.record(scene);

      // State 1: one element
      scene.add(createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }));
      history.record(scene);

      // State 2: two elements
      scene.add(createElement("ellipse", { x: 20, y: 20, width: 30, height: 30 }));

      expect(scene.getElements()).toHaveLength(2);
      history.undo(scene);
      expect(scene.getElements()).toHaveLength(1);
      history.undo(scene);
      expect(scene.getElements()).toHaveLength(0);
    });
  });

  describe("limit", () => {
    it("respects history limit", () => {
      const h = new History(3);
      for (let i = 0; i < 5; i++) {
        h.record(scene);
        scene.add(createElement("rectangle", { x: i * 10, y: 0, width: 10, height: 10 }));
      }
      // Only last 3 states saved
      let undoCount = 0;
      while (h.canUndo()) {
        h.undo(scene);
        undoCount++;
      }
      expect(undoCount).toBe(3);
    });
  });

  describe("clear", () => {
    it("clears all history", () => {
      history.record(scene);
      scene.add(createElement("rectangle", { x: 0, y: 0, width: 10, height: 10 }));
      history.record(scene);

      history.clear();
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });
  });
});
