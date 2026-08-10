import type { Camera } from "./Camera";
import type { EmbedElement } from "./types";

export interface EmbedManagerDeps {
  camera: Camera;
  getElements: () => { type: string; id: string; x: number; y: number; width: number; height: number; angle: number; opacity: number; src?: string }[];
  getSelectedIds: () => Set<string>;
  getSelectionColor: () => string;
  isLocked: () => boolean;
  onActiveChange: (id: string | null) => void;
}

/**
 * Manages embed (iframe) DOM overlays: creation, positioning, activation,
 * and removal — synchronized with the canvas pan/zoom.
 */
export class EmbedManager {
  private embedLayer: HTMLDivElement;
  private embedNodes = new Map<string, HTMLDivElement>();
  private activeEmbedId: string | null = null;
  private deps: EmbedManagerDeps;

  constructor(container: HTMLElement, deps: EmbedManagerDeps) {
    this.deps = deps;

    this.embedLayer = document.createElement("div");
    Object.assign(this.embedLayer.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "1",
    } as Partial<CSSStyleDeclaration>);
    container.appendChild(this.embedLayer);
  }

  getActiveEmbedId(): string | null {
    return this.activeEmbedId;
  }

  activate(id: string): void {
    if (this.activeEmbedId === id) return;
    this.activeEmbedId = id;
    this.deps.onActiveChange(id);
    this.sync();
  }

  deactivate(): void {
    if (this.activeEmbedId === null) return;
    this.activeEmbedId = null;
    this.deps.onActiveChange(null);
    this.sync();
  }

  /**
   * Reconcile the embed DOM overlay with the current scene: create/update/remove
   * iframe wrappers and position them to match each embed element under the
   * current camera transform.
   */
  sync(): void {
    const seen = new Set<string>();
    const zoom = this.deps.camera.zoom;
    const selectionColor = this.deps.getSelectionColor();
    const selectedIds = this.deps.getSelectedIds();
    const locked = this.deps.isLocked();

    for (const el of this.deps.getElements()) {
      if (el.type !== "embed") continue;
      const embed = el as unknown as EmbedElement;
      seen.add(embed.id);

      let node = this.embedNodes.get(embed.id);
      let iframe: HTMLIFrameElement;
      if (!node) {
        node = document.createElement("div");
        Object.assign(node.style, {
          position: "absolute",
          top: "0",
          left: "0",
          transformOrigin: "center center",
          overflow: "hidden",
          borderRadius: "6px",
          background: "#000",
          boxSizing: "border-box",
        } as Partial<CSSStyleDeclaration>);
        iframe = document.createElement("iframe");
        Object.assign(iframe.style, {
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
        } as Partial<CSSStyleDeclaration>);
        iframe.setAttribute(
          "allow",
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
        );
        iframe.setAttribute("referrerpolicy", "no-referrer");
        iframe.setAttribute(
          "sandbox",
          "allow-scripts allow-same-origin allow-popups allow-forms allow-presentation",
        );
        node.appendChild(iframe);
        this.embedLayer.appendChild(node);
        this.embedNodes.set(embed.id, node);
      } else {
        iframe = node.firstElementChild as HTMLIFrameElement;
      }

      if (iframe.getAttribute("src") !== embed.src) {
        if (embed.src) iframe.setAttribute("src", embed.src);
        else iframe.removeAttribute("src");
      }

      const tl = this.deps.camera.worldToScreen(embed.x, embed.y);
      const w = embed.width * zoom;
      const h = embed.height * zoom;
      const active = this.activeEmbedId === embed.id;
      const selected = selectedIds.has(embed.id);
      Object.assign(node.style, {
        left: `${tl.x}px`,
        top: `${tl.y}px`,
        width: `${w}px`,
        height: `${h}px`,
        transform: embed.angle ? `rotate(${embed.angle}rad)` : "none",
        pointerEvents: active || locked ? "auto" : "none",
        opacity: String(embed.opacity),
        outline: active || selected ? `2px solid ${selectionColor}` : "none",
      } as Partial<CSSStyleDeclaration>);
    }

    for (const [id, node] of this.embedNodes) {
      if (!seen.has(id)) {
        node.remove();
        this.embedNodes.delete(id);
        if (this.activeEmbedId === id) this.deactivate();
      }
    }
  }

  destroy(): void {
    this.activeEmbedId = null;
    for (const node of this.embedNodes.values()) node.remove();
    this.embedNodes.clear();
    this.embedLayer.remove();
  }
}

/**
 * Normalize common video/embed URLs to their embeddable form.
 * YouTube, Vimeo URLs are auto-converted.
 */
export function normalizeEmbedUrl(raw: string): string {
  const url = raw.trim();
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    // YouTube: youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname.startsWith("/embed/")) return url;
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const shorts = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shorts) return `https://www.youtube.com/embed/${shorts[1]}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    // Vimeo: vimeo.com/ID -> player.vimeo.com/video/ID
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    // Not a valid absolute URL; return as provided.
  }
  return url;
}
