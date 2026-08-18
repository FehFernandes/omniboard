/**
 * SelectionTool — Handles select, move, resize, rotate, bend, box-select.
 */

import type { Tool, ToolContext } from "../plugin-types";
import type { BoardElement, Bounds, LinearElement, Point } from "../types";
import type { InternalToolContext } from "./types";
import { createElement } from "../elements";
import { elementBounds, boundsFromPoints } from "../geometry";
import { getHandles, hitTestHandle, RESIZE_CURSORS, rotationFromPointer } from "../selection";
import { computeSnap } from "../snapping";
import {
  ANCHOR_GRAB_RADIUS,
  findAnchorHost,
  findConnectionTarget,
  getElementAnchorHandles,
  getElementAnchors,
} from "../connections";
import { tasksHitTest } from "../tasks";
import type { TasksElement } from "../types";

export class SelectionTool implements Tool {
  readonly id = "selection";
  readonly label = "Select";
  readonly cursor = "default";
  readonly shortcuts = ["v", "1"];

  onActivate(ctx: ToolContext): void {
    ctx.setCursor("default");
  }

  onPointerDown(ctx: ToolContext, e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;

    // If space is down, pan instead.
    if (ictx.isSpaceDown()) {
      ictx.setHoverAnchors(null);
      ictx.setInteraction({ kind: "panning", lastScreen: ictx.getScreenPoint(e) });
      ictx.capturePointer(e);
      ctx.setCursor("grabbing");
      return;
    }

    ictx.commitActiveEditor();
    this.onSelectionPointerDown(ictx, world, e.shiftKey);
    ictx.capturePointer(e);
    ictx.markDirty();
  }

  onPointerMove(ctx: ToolContext, e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;
    const interaction = ictx.getInteraction();

    switch (interaction.kind) {
      case "idle":
        this.updateHoverCursor(ictx, world);
        return;

      case "panning": {
        const s = ictx.getScreenPoint(e);
        const dx = s.x - interaction.lastScreen.x;
        const dy = s.y - interaction.lastScreen.y;
        ictx.panBy(dx, dy);
        interaction.lastScreen = s;
        ictx.emitCamera();
        break;
      }

      case "creating": {
        // Creating an arrow from an anchor.
        const el = interaction.element;
        const start = interaction.startWorld;
        let endX = world.x;
        let endY = world.y;
        ictx.setConnectionIndicator(null);
        if (el.type === "arrow") {
          const threshold = 24 / ictx.getZoom();
          const candidate = findConnectionTarget(
            world,
            ictx.getElements(),
            new Set([el.id]),
            threshold,
          );
          if (candidate) {
            endX = candidate.point.x;
            endY = candidate.point.y;
            ictx.setConnectionIndicator({
              point: candidate.point,
              anchors: getElementAnchors(candidate.element),
            });
          }
        }
        ictx.updateElement(el.id, {
          width: endX - start.x,
          height: endY - start.y,
          points: [{ x: 0, y: 0 }, { x: endX - start.x, y: endY - start.y }],
        } as Partial<LinearElement>);
        break;
      }

      case "moving": {
        const dx = world.x - interaction.startWorld.x;
        const dy = world.y - interaction.startWorld.y;
        let sx = 0;
        let sy = 0;
        ictx.setSnapGuides([]);
        if (!(e.ctrlKey || e.metaKey)) {
          const movedIds = new Set(interaction.origins.keys());
          let mb: Bounds | null = null;
          for (const orig of interaction.origins.values()) {
            const b = elementBounds({ ...orig, x: orig.x + dx, y: orig.y + dy } as BoardElement);
            mb = mb
              ? {
                  minX: Math.min(mb.minX, b.minX),
                  minY: Math.min(mb.minY, b.minY),
                  maxX: Math.max(mb.maxX, b.maxX),
                  maxY: Math.max(mb.maxY, b.maxY),
                }
              : b;
          }
          if (mb) {
            const others: Bounds[] = [];
            for (const el of ictx.getElements()) {
              if (!movedIds.has(el.id)) others.push(elementBounds(el));
            }
            const snap = computeSnap(mb, others, 6 / ictx.getZoom());
            sx = snap.dx;
            sy = snap.dy;
            ictx.setSnapGuides(snap.guides);
          }
        }
        for (const [id, orig] of interaction.origins) {
          ictx.updateElement(id, { x: orig.x + dx + sx, y: orig.y + dy + sy });
        }
        ictx.updateConnectedArrows(new Set(interaction.origins.keys()));
        break;
      }

      case "resizing":
        ictx.applyResize(interaction.orig, interaction.handle, world);
        break;

      case "rotating": {
        const orig = interaction.orig;
        ictx.updateElement(orig.id, {
          angle: rotationFromPointer(orig, world),
        });
        break;
      }

      case "bending": {
        const co = {
          x: world.x - interaction.midpoint.x,
          y: world.y - interaction.midpoint.y,
        };
        ictx.updateElement(interaction.arrowId, { controlOffset: co } as Partial<LinearElement>);
        break;
      }

      case "boxselect": {
        const s = interaction.startWorld;
        ictx.setSelectionBox(boundsFromPoints([s, world]));
        break;
      }
    }
    ictx.markDirty();
  }

  onPointerUp(ctx: ToolContext, e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;
    ictx.releasePointer(e);
    const it = ictx.getInteraction();

    switch (it.kind) {
      case "creating": {
        // Arrow created from connection anchor — finalize.
        const live = ictx.getElement(it.element.id);
        if (live) {
          const tiny = Math.abs(live.width) < 2 && Math.abs(live.height) < 2;
          if (tiny) {
            ictx.removeElement(live.id);
          } else {
            // Bind target connection.
            if (live.type === "arrow") {
              const threshold = 24 / ictx.getZoom();
              const exclude = new Set([live.id]);
              const els = ictx.getElements();
              const arrow = live as LinearElement;
              const endPt = { x: arrow.x + arrow.points[arrow.points.length - 1].x, y: arrow.y + arrow.points[arrow.points.length - 1].y };
              const tgt = findConnectionTarget(endPt, els, exclude, threshold);
              if (tgt) {
                const pts = [...arrow.points];
                pts[pts.length - 1] = { x: tgt.point.x - arrow.x, y: tgt.point.y - arrow.y };
                ictx.updateElement(live.id, {
                  targetId: tgt.element.id,
                  targetAnchor: tgt.anchor,
                  points: pts,
                  width: pts[pts.length - 1].x,
                  height: pts[pts.length - 1].y,
                } as Partial<LinearElement>);
              }
            }
            ictx.setSelection([live.id]);
          }
        }
        break;
      }
      case "boxselect": {
        const box = boundsFromPoints([it.startWorld, world]);
        ictx.applyBoxSelection(box);
        ictx.setSelectionBox(null);
        break;
      }
      case "panning":
        break;
      case "moving": {
        const moved = Math.hypot(world.x - it.startWorld.x, world.y - it.startWorld.y);
        const isClick = moved < 3 / ictx.getZoom();
        if (isClick && it.maybeActivateEmbedId) {
          ictx.embedActivate(it.maybeActivateEmbedId);
        }
        if (isClick && it.maybeTaskAction && it.maybeTaskAction.hit) {
          ictx.applyTaskAction(it.maybeTaskAction.id, it.maybeTaskAction.hit);
        }
        break;
      }
    }

    if (it.kind !== "idle") {
      ictx.emitChange();
    }
    ictx.setSnapGuides([]);
    ictx.setConnectionIndicator(null);
    ictx.setInteraction({ kind: "idle" });
    ctx.setCursor("default");
    ictx.markDirty();
  }

  onDoubleClick(ctx: ToolContext, _e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;
    const hit = ictx.hitTest(world);
    if (hit && hit.type === "embed") {
      ictx.setSelection([hit.id]);
      ictx.embedActivate(hit.id);
      return;
    }
    if (hit && hit.type === "image") {
      ictx.setSelection([hit.id]);
      return;
    }
    // Link and note open UI outside the canvas (navigate / note modal).
    if (hit && (hit.type === "link" || hit.type === "note")) {
      ictx.setSelection([hit.id]);
      ictx.activateElement(hit, "click");
      return;
    }
    if (hit && (hit.type === "sticky" || hit.type === "frame")) {
      ictx.setSelection([hit.id]);
      // Frame: a double click edits the NAME (the corner label), not a centered
      // label — text in the middle of a large frame makes no sense.
      if (hit.type === "frame") ictx.openNameEditor(hit);
      else ictx.openLabelEditor(hit);
      return;
    }
    if (hit && hit.type === "tasks") {
      ictx.setSelection([hit.id]);
      const t = hit as TasksElement;
      const action = tasksHitTest(t, world);
      if (action && action.type === "toggle") {
        const cur = t.items[action.index];
        const text = window.prompt("Editar tarefa:", cur?.text ?? "");
        if (text !== null) {
          const trimmed = text.trim();
          const items = trimmed === ""
            ? t.items.filter((_: any, i: number) => i !== action.index)
            : t.items.map((it: any, i: number) => (i === action.index ? { ...it, text: trimmed } : it));
          ictx.updateElement(hit.id, { items } as Partial<BoardElement>);
          ictx.emitChange();
        }
      } else if (action && action.type === "add") {
        ictx.applyTaskAction(hit.id, action);
      }
      return;
    }
    if (hit && hit.type === "text") {
      ictx.setSelection([hit.id]);
      ictx.openTextEditor(hit as any);
    } else if (hit) {
      ictx.setSelection([hit.id]);
      ictx.openLabelEditor(hit);
    } else {
      // Double-click on empty space -> create text element.
      ictx.commitHistory();
      const el = createElement(
        "text",
        { x: world.x, y: world.y, width: 0, height: 0 },
        ictx.getStyle(),
      );
      ictx.addElement(el);
      ictx.setSelection([el.id]);
      ictx.openTextEditor(el as any);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private onSelectionPointerDown(ictx: InternalToolContext, world: Point, shift: boolean): void {
    // If the pointer is directly on a hover-anchor, start creating an arrow from it.
    const anchorHit = ictx.hitHoverAnchor(world);
    if (anchorHit) {
      ictx.commitHistory();
      const el = createElement(
        "arrow",
        {
          x: anchorHit.point.x,
          y: anchorHit.point.y,
          width: 0,
          height: 0,
          points: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
          sourceId: anchorHit.elementId,
          sourceAnchor: anchorHit.anchor,
          curveType: ictx.getCurveType(),
        } as Partial<BoardElement> & { x: number; y: number },
        ictx.getStyle(),
      );
      ictx.addElement(el);
      ictx.setInteraction({ kind: "creating", element: el, startWorld: anchorHit.point });
      ictx.setHoverAnchors(null);
      return;
    }

    // 1. Handle drag (resize/rotate) when a single element is selected.
    const selectedIds = ictx.getSelectedIds();
    if (selectedIds.length === 1) {
      const el = ictx.getElement(selectedIds[0]);
      if (el) {
        // Bend handle for 2-point arrows/lines.
        if (
          (el.type === "arrow" || el.type === "line") &&
          (el as LinearElement).points.length === 2
        ) {
          const lin = el as LinearElement;
          const p0 = { x: lin.x + lin.points[0].x, y: lin.y + lin.points[0].y };
          const pN = { x: lin.x + lin.points[1].x, y: lin.y + lin.points[1].y };
          const mx = (p0.x + pN.x) / 2;
          const my = (p0.y + pN.y) / 2;
          const co = lin.controlOffset ?? { x: 0, y: 0 };
          const bx = mx + co.x;
          const by = my + co.y;
          const threshold = 8 / ictx.getZoom();
          if (Math.hypot(world.x - bx, world.y - by) <= threshold) {
            ictx.commitHistory();
            ictx.setInteraction({ kind: "bending", arrowId: el.id, midpoint: { x: mx, y: my } });
            return;
          }
        }

        const handles = getHandles(elementBounds(el), el.angle, ictx.getZoom());
        const handle = hitTestHandle(handles, world, ictx.getZoom());
        if (handle === "rotate") {
          ictx.commitHistory();
          ictx.setInteraction({ kind: "rotating", orig: el });
          return;
        }
        if (handle) {
          ictx.commitHistory();
          ictx.setInteraction({ kind: "resizing", handle, orig: el });
          return;
        }
      }
    }

    // 2. Hit test elements (top-most first).
    const hit = ictx.hitTest(world);
    if (hit) {
      const wasSoleSelected =
        selectedIds.length === 1 && selectedIds[0] === hit.id;
      if (shift) {
        const ids = new Set(selectedIds);
        if (ids.has(hit.id)) ids.delete(hit.id);
        else ids.add(hit.id);
        ictx.setSelection([...ids]);
      } else if (!selectedIds.includes(hit.id)) {
        ictx.setSelection([hit.id]);
      }
      const currentSelected = ictx.getSelectedIds();
      if (currentSelected.length > 0) {
        ictx.commitHistory();
        ictx.setInteraction({
          kind: "moving",
          startWorld: world,
          origins: ictx.snapshotSelection(),
          maybeActivateEmbedId:
            hit.type === "embed" && wasSoleSelected ? hit.id : undefined,
          maybeTaskAction:
            hit.type === "tasks"
              ? { id: hit.id, hit: tasksHitTest(hit as TasksElement, world) }
              : undefined,
        });
      }
      return;
    }

    // 3. Empty space -> box select.
    if (!shift) {
      ictx.setSelection([]);
    }
    ictx.setInteraction({ kind: "boxselect", startWorld: world });
  }

  private updateHoverCursor(ictx: InternalToolContext, world: Point): void {
    let cursor = "default";
    const selectedIds = ictx.getSelectedIds();
    if (selectedIds.length === 1) {
      const el = ictx.getElement(selectedIds[0]);
      if (el) {
        const handles = getHandles(elementBounds(el), el.angle, ictx.getZoom());
        const h = hitTestHandle(handles, world, ictx.getZoom());
        if (h) cursor = RESIZE_CURSORS[h];
      }
    }
    // Connection anchors: they show up for the element under the cursor and stay
    // visible in the zone around it, where the dots actually are. Without that
    // zone they vanished halfway and pulling the arrow was impossible.
    const hit = ictx.hitTest(world);
    const host = findAnchorHost(world, ictx.getElementsRaw(), ictx.getZoom(), hit);
    if (host) {
      // Anchors pushed outwards: avoids competing for the click with the resize
      // handles, which sit in the middle of the edges.
      const anchors = getElementAnchorHandles(host, ictx.getZoom());
      const aThreshold = ANCHOR_GRAB_RADIUS / ictx.getZoom();
      let active: string | undefined;
      for (const a of anchors) {
        if (Math.hypot(a.point.x - world.x, a.point.y - world.y) <= aThreshold) {
          cursor = "crosshair";
          active = a.anchor;
          break;
        }
      }
      // `active` lets the renderer highlight the dot under the cursor: without
      // it the user gets no feedback that an arrow starts there.
      ictx.setHoverAnchors({ elementId: host.id, anchors, active });
      ictx.markDirty();
    } else {
      ictx.setHoverAnchors(null);
      ictx.markDirty();
    }
    if (cursor === "default" && hit) cursor = "move";
    ictx.setCursor(cursor);
  }
}
