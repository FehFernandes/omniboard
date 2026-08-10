import { describe, it, expect } from "vitest";
import { createElement, hitTestElement } from "../src/elements";
import { ElementRegistryImpl } from "../src/ElementRegistry";
import type { LinkElement, NoteElement } from "../src/types";

describe("link element (shortcut to another board)", () => {
  it("is born with no destination: the incomplete state is explicit", () => {
    const el = createElement("link", { x: 0, y: 0, width: 240, height: 72 }) as LinkElement;
    expect(el.type).toBe("link");
    expect(el.targetId).toBeUndefined();
    expect(el.label).toBe("");
  });

  it("accepts destination and label on creation", () => {
    const el = createElement("link", {
      x: 0, y: 0, width: 240, height: 72,
      targetId: "board-9", label: "Arquitetura", subtitle: "board",
    } as never) as LinkElement;
    expect(el.targetId).toBe("board-9");
    expect(el.label).toBe("Arquitetura");
  });

  it("is clickable across the whole card area", () => {
    const el = createElement("link", { x: 100, y: 100, width: 240, height: 72 });
    expect(hitTestElement(el, { x: 220, y: 136 })).toBe(true);
    expect(hitTestElement(el, { x: 500, y: 500 })).toBe(false);
  });

  it("the registry knows the type (serialization/plugins)", () => {
    const reg = new ElementRegistryImpl();
    expect(reg.has("link")).toBe(true);
    expect(reg.getTypes()).toContain("link");
    expect(reg.create("link", { x: 0, y: 0 }).type).toBe("link");
  });
});

describe("note element (long note)", () => {
  it("is born empty, with a strip color", () => {
    const el = createElement("note", { x: 0, y: 0, width: 260, height: 200 }) as NoteElement;
    expect(el.type).toBe("note");
    expect(el.text).toBe("");
    expect(el.title).toBe("");
    expect(el.color).toBeTruthy();
  });

  it("keeps the full text in the element (it is the source of truth)", () => {
    const long = "line 1\n".repeat(200);
    const el = createElement("note", {
      x: 0, y: 0, width: 260, height: 200, title: "Minutes", text: long,
    } as never) as NoteElement;
    expect(el.text).toBe(long);
    expect(el.title).toBe("Minutes");
  });

  it("is clickable across the whole card area", () => {
    const el = createElement("note", { x: 0, y: 0, width: 260, height: 200 });
    expect(hitTestElement(el, { x: 130, y: 100 })).toBe(true);
    expect(hitTestElement(el, { x: 400, y: 100 })).toBe(false);
  });

  it("the registry knows the type", () => {
    const reg = new ElementRegistryImpl();
    expect(reg.has("note")).toBe(true);
    expect(reg.create("note", { x: 0, y: 0 }).type).toBe("note");
  });

  // Note and sticky are different things: a sticky is short text on the canvas, a
  // note is long text with a modal. Mixing the two loses their reason to exist.
  it("is not the same thing as a sticky", () => {
    const note = createElement("note", { x: 0, y: 0, width: 100, height: 100 });
    const sticky = createElement("sticky", { x: 0, y: 0, width: 100, height: 100 });
    expect(note.type).not.toBe(sticky.type);
  });
});
