/**
 * Optional built-in DOM overlays: a right-click context menu and a
 * floating toolbar shown above the current selection. They are intentionally
 * dumb — the Board decides which items/buttons to show and what they do; these
 * classes only handle rendering, positioning and dismissal.
 *
 * Disable them via `BoardOptions.contextMenu` / `selectionToolbar` to build your
 * own UI on top of the events/API instead.
 */

export interface MenuItem {
  /** Visible label. Ignored when `separator` is true. */
  label?: string;
  /** Optional leading icon as an inline SVG string. */
  icon?: string;
  /** Right-aligned shortcut hint, e.g. "Ctrl+D". */
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Render in a "destructive" color (e.g. delete). */
  danger?: boolean;
  /** Render a divider instead of a clickable row. */
  separator?: boolean;
}

export interface ToolbarButton {
  /** Text/emoji fallback shown when `icon` is not provided. */
  label: string;
  /** Icon as an inline SVG string (preferred over `label`). */
  icon?: string;
  title?: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}

export interface OverlayTheme {
  bg: string;
  fg: string;
  border: string;
  hover: string;
  accent: string;
  danger: string;
  shadow: string;
}

export const OVERLAY_THEMES: Record<"light" | "dark", OverlayTheme> = {
  light: {
    bg: "#ffffff",
    fg: "#1e1e1e",
    border: "#e5e5e5",
    hover: "#f1f0ff",
    accent: "#6965db",
    danger: "#e03131",
    shadow: "0 6px 24px #0003",
  },
  dark: {
    bg: "#26262b",
    fg: "#e3e3e3",
    border: "#3a3a3c",
    hover: "#33323d",
    accent: "#a8a5ff",
    danger: "#ff6b6b",
    shadow: "0 6px 24px #0007",
  },
};

/** Right-click context menu. */
export class ContextMenu {
  private el: HTMLDivElement;
  private boundOutside = (e: MouseEvent) => this.onOutside(e);
  private boundKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.hide();
  };

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "absolute",
      zIndex: "30",
      display: "none",
      minWidth: "180px",
      padding: "6px",
      borderRadius: "10px",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "13px",
      userSelect: "none",
    } as CSSStyleDeclaration);
    container.appendChild(this.el);
  }

  isOpen(): boolean {
    return this.el.style.display !== "none";
  }

  show(
    screenX: number,
    screenY: number,
    items: MenuItem[],
    theme: OverlayTheme,
    container: HTMLElement,
  ): void {
    this.el.innerHTML = "";
    Object.assign(this.el.style, {
      background: theme.bg,
      color: theme.fg,
      border: `1px solid ${theme.border}`,
      boxShadow: theme.shadow,
    });

    for (const item of items) {
      if (item.separator) {
        const hr = document.createElement("div");
        Object.assign(hr.style, {
          height: "1px",
          background: theme.border,
          margin: "4px 2px",
        } as CSSStyleDeclaration);
        this.el.appendChild(hr);
        continue;
      }
      const row = document.createElement("button");
      row.type = "button";
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        width: "100%",
        padding: "7px 10px",
        border: "none",
        borderRadius: "6px",
        background: "transparent",
        color: item.danger ? theme.danger : theme.fg,
        cursor: item.disabled ? "not-allowed" : "pointer",
        opacity: item.disabled ? "0.45" : "1",
        font: "inherit",
        textAlign: "left",
      } as CSSStyleDeclaration);

      const label = document.createElement("span");
      label.textContent = item.label ?? "";
      if (item.icon) {
        const left = document.createElement("span");
        Object.assign(left.style, {
          display: "flex",
          alignItems: "center",
          gap: "9px",
        } as CSSStyleDeclaration);
        const ic = document.createElement("span");
        ic.innerHTML = item.icon;
        Object.assign(ic.style, {
          display: "inline-flex",
          width: "16px",
          height: "16px",
          opacity: "0.85",
        } as CSSStyleDeclaration);
        const svgEl = ic.firstElementChild as SVGElement | null;
        if (svgEl) {
          svgEl.setAttribute("width", "16");
          svgEl.setAttribute("height", "16");
        }
        left.appendChild(ic);
        left.appendChild(label);
        row.appendChild(left);
      } else {
        row.appendChild(label);
      }
      if (item.shortcut) {
        const sc = document.createElement("span");
        sc.textContent = item.shortcut;
        Object.assign(sc.style, { opacity: "0.5", fontSize: "11px" });
        row.appendChild(sc);
      }

      if (!item.disabled) {
        row.addEventListener("mouseenter", () => {
          row.style.background = theme.hover;
        });
        row.addEventListener("mouseleave", () => {
          row.style.background = "transparent";
        });
        row.addEventListener("click", () => {
          this.hide();
          item.onClick?.();
        });
      }
      this.el.appendChild(row);
    }

    // Position with edge flipping inside the container.
    this.el.style.display = "block";
    this.el.style.left = "0px";
    this.el.style.top = "0px";
    const rect = container.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = screenX;
    let y = screenY;
    if (x + w > rect.width) x = Math.max(0, rect.width - w - 4);
    if (y + h > rect.height) y = Math.max(0, rect.height - h - 4);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;

    // Defer so the opening click doesn't immediately dismiss it.
    setTimeout(() => {
      document.addEventListener("mousedown", this.boundOutside, true);
      document.addEventListener("keydown", this.boundKey, true);
    }, 0);
  }

  hide(): void {
    if (!this.isOpen()) return;
    this.el.style.display = "none";
    document.removeEventListener("mousedown", this.boundOutside, true);
    document.removeEventListener("keydown", this.boundKey, true);
  }

  private onOutside(e: MouseEvent): void {
    if (!this.el.contains(e.target as Node)) this.hide();
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }
}

/** Floating toolbar shown above the current selection. */
export class SelectionToolbar {
  private el: HTMLDivElement;
  private theme: OverlayTheme = OVERLAY_THEMES.light;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "absolute",
      zIndex: "28",
      display: "none",
      alignItems: "center",
      gap: "2px",
      padding: "4px",
      borderRadius: "10px",
      fontFamily: "system-ui, -apple-system, sans-serif",
      transform: "translate(-50%, -100%)",
      pointerEvents: "auto",
      whiteSpace: "nowrap",
    } as CSSStyleDeclaration);
    container.appendChild(this.el);
  }

  setTheme(theme: OverlayTheme): void {
    this.theme = theme;
    Object.assign(this.el.style, {
      background: theme.bg,
      color: theme.fg,
      border: `1px solid ${theme.border}`,
      boxShadow: theme.shadow,
    });
  }

  setButtons(buttons: ToolbarButton[]): void {
    const theme = this.theme;
    this.el.innerHTML = "";
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      if (b.icon) btn.innerHTML = b.icon;
      else btn.textContent = b.label;
      if (b.title) btn.title = b.title;
      Object.assign(btn.style, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "32px",
        height: "32px",
        padding: "0 7px",
        border: "none",
        borderRadius: "7px",
        background: b.active ? theme.accent : "transparent",
        color: b.active ? "#fff" : b.danger ? theme.danger : theme.fg,
        cursor: "pointer",
        font: "inherit",
        fontSize: "15px",
      } as CSSStyleDeclaration);
      btn.addEventListener("mouseenter", () => {
        if (!b.active) btn.style.background = theme.hover;
      });
      btn.addEventListener("mouseleave", () => {
        if (!b.active) btn.style.background = "transparent";
      });
      // Use mousedown+preventDefault so clicking a button doesn't clear the
      // canvas selection before the action runs.
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.onClick();
      });
      this.el.appendChild(btn);
    }
  }

  setPosition(x: number, y: number): void {
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.display = "flex";
  }

  hide(): void {
    this.el.style.display = "none";
  }

  isVisible(): boolean {
    return this.el.style.display !== "none";
  }

  destroy(): void {
    this.el.remove();
  }
}
