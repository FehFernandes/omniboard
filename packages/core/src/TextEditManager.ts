import type { Camera } from "./Camera";
import { textCanvasFont } from "./CanvasRenderer";
import { DEFAULT_LABEL_STYLE, DEFAULT_TEXT_STYLE } from "./elements";
import { elementCenter, FRAME_NAME_FONT_SIZE, frameNameOrigin } from "./geometry";
import type { BoardElement, FrameElement, TextElement, TextStyle } from "./types";

export interface TextEditManagerDeps {
  camera: Camera;
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  getElement(id: string): BoardElement | undefined;
  updateElement(id: string, patch: Partial<BoardElement>): void;
  removeElement(id: string): void;
  commitHistory(): void;
  getElementTextStyle(el: TextElement): TextStyle;
  getElementLabelStyle(el: BoardElement): TextStyle;
  /** Text color of the frame name (follows the theme). */
  getNameColor(): string;
  onTextCommitted(): void;
  markDirty(): void;
}

/**
 * Manages all inline text editing (standalone TextElements and shape labels).
 * Follows the same deps-injection pattern as EmbedManager.
 */
export class TextEditManager {
  private deps: TextEditManagerDeps;
  private textarea: HTMLTextAreaElement | null = null;
  private editingTextId: string | null = null;
  private editingLabelId: string | null = null;
  /** Frame whose NAME is being edited (label in the top-right corner). */
  private editingFrameNameId: string | null = null;

  constructor(deps: TextEditManagerDeps) {
    this.deps = deps;
  }

  // ------------------------------------------------------- Public API

  openTextEditor(el: TextElement): void {
    this.removeTextarea();
    this.editingTextId = el.id;

    const ta = document.createElement("textarea");
    ta.value = el.text;
    Object.assign(ta.style, {
      position: "absolute",
      background: "transparent",
      border: "none",
      outline: "none",
      overflow: "hidden",
      resize: "none",
      padding: "0",
      margin: "0",
      whiteSpace: "pre",
      color: el.strokeColor,
      lineHeight: "1.25",
      textAlign: el.textAlign ?? DEFAULT_TEXT_STYLE.textAlign,
      fontWeight: el.fontWeight ?? DEFAULT_TEXT_STYLE.fontWeight,
      fontStyle: el.fontStyle ?? DEFAULT_TEXT_STYLE.fontStyle,
      zIndex: "10",
      boxSizing: "border-box",
    } as CSSStyleDeclaration);

    this.deps.container.appendChild(ta);
    this.textarea = ta;
    this.positionTextarea(el);

    const commit = () => this.commitTextIfEditing();
    ta.addEventListener("blur", commit);
    ta.addEventListener("input", () => this.autoSizeTextarea());
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ta.blur();
      }
    });

    requestAnimationFrame(() => {
      ta.focus();
      ta.select();
    });
    this.deps.markDirty();
  }

  openLabelEditor(el: BoardElement): void {
    this.removeTextarea();
    this.deps.commitHistory();
    this.editingLabelId = el.id;

    const ta = document.createElement("textarea");
    ta.value = el.label ?? "";
    Object.assign(ta.style, {
      position: "absolute",
      background: "transparent",
      border: "none",
      outline: "none",
      overflow: "hidden",
      resize: "none",
      padding: "0",
      margin: "0",
      textAlign: "center",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      color: el.strokeColor,
      lineHeight: "1.25",
      zIndex: "10",
      transform: "translate(-50%, -50%)",
      transformOrigin: "center center",
      boxSizing: "border-box",
    } as CSSStyleDeclaration);

    this.deps.container.appendChild(ta);
    this.textarea = ta;
    this.positionLabelTextarea(el);

    ta.addEventListener("blur", () => this.commitLabelIfEditing());
    ta.addEventListener("input", () => this.autoSizeLabelTextarea());
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") ta.blur();
    });

    requestAnimationFrame(() => {
      ta.focus();
      ta.select();
    });
    this.deps.markDirty();
  }

  /**
   * Editor for the frame NAME, on top of the label in the top-right corner.
   *
   * It does not reuse `openLabelEditor` because that one centers the field on
   * the element: on an 800px frame the name would show up in the middle of the
   * area and "jump" to the corner on commit. Here the field is born where the
   * name is drawn.
   */
  openFrameNameEditor(el: FrameElement): void {
    this.removeTextarea();
    this.deps.commitHistory();
    this.editingFrameNameId = el.id;

    const ta = document.createElement("textarea");
    ta.value = el.title || el.label || "";
    ta.rows = 1;
    Object.assign(ta.style, {
      position: "absolute",
      background: "transparent",
      border: "none",
      outline: "none",
      overflow: "hidden",
      resize: "none",
      padding: "0",
      margin: "0",
      whiteSpace: "pre",
      textAlign: "left",
      fontWeight: "400",
      color: this.deps.getNameColor(),
      lineHeight: "1",
      zIndex: "10",
      boxSizing: "border-box",
    } as CSSStyleDeclaration);

    this.deps.container.appendChild(ta);
    this.textarea = ta;
    this.positionFrameNameTextarea(el);

    ta.addEventListener("blur", () => this.commitFrameNameIfEditing());
    ta.addEventListener("keydown", (ev) => {
      // The name is a single line: Enter commits instead of breaking.
      if (ev.key === "Escape" || ev.key === "Enter") {
        ev.preventDefault();
        ta.blur();
      }
    });

    requestAnimationFrame(() => {
      ta.focus();
      ta.select();
    });
    this.deps.markDirty();
  }

  commitActiveEditor(): void {
    this.commitTextIfEditing();
    this.commitLabelIfEditing();
    this.commitFrameNameIfEditing();
  }

  isEditing(): boolean {
    return (
      this.editingTextId !== null ||
      this.editingLabelId !== null ||
      this.editingFrameNameId !== null
    );
  }

  getEditingTextId(): string | null {
    return this.editingTextId;
  }

  getEditingLabelId(): string | null {
    return this.editingLabelId;
  }

  /** Frame whose name is being edited (the renderer hides the label). */
  getEditingFrameNameId(): string | null {
    return this.editingFrameNameId;
  }

  measureText(
    text: string,
    style: Pick<TextStyle, "fontSize" | "fontFamily" | "fontWeight" | "fontStyle">,
  ): { width: number; height: number } {
    const ctx = this.deps.canvas.getContext("2d")!;
    ctx.save();
    ctx.font = textCanvasFont(style);
    const lines = text.split("\n");
    let width = 0;
    for (const line of lines) {
      width = Math.max(width, ctx.measureText(line).width);
    }
    ctx.restore();
    return { width: Math.ceil(width), height: Math.ceil(lines.length * style.fontSize * 1.25) };
  }

  removeTextarea(): void {
    if (this.textarea) {
      this.textarea.remove();
      this.textarea = null;
    }
  }

  destroy(): void {
    this.removeTextarea();
    this.editingTextId = null;
    this.editingLabelId = null;
    this.editingFrameNameId = null;
  }

  // ------------------------------------------------------- Private

  private positionTextarea(el: TextElement): void {
    if (!this.textarea) return;
    const textStyle = this.deps.getElementTextStyle(el);
    const lineHeight = textStyle.fontSize * 1.25;
    const lines = (el.text || "").split("\n").length;
    const textHeight = Math.max(lineHeight, lines * lineHeight);
    const y =
      textStyle.verticalAlign === "middle"
        ? el.y + Math.max(0, el.height - textHeight) / 2
        : el.y;
    const screen = this.deps.camera.worldToScreen(el.x, y);
    const zoom = this.deps.camera.zoom;
    const minWidth = Math.max(20, el.width) * zoom;
    this.textarea.dataset.minWidth = String(minWidth);
    Object.assign(this.textarea.style, {
      left: `${screen.x}px`,
      top: `${screen.y}px`,
      minWidth: `${minWidth}px`,
      fontSize: `${textStyle.fontSize * zoom}px`,
      fontFamily: textStyle.fontFamily,
      fontWeight: textStyle.fontWeight,
      fontStyle: textStyle.fontStyle,
      textAlign: textStyle.textAlign,
      transformOrigin: "top left",
    });
    this.autoSizeTextarea();
  }

  private autoSizeTextarea(): void {
    const ta = this.textarea;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.width = "auto";
    const minWidth = Number(ta.dataset.minWidth || 20);
    ta.style.height = `${ta.scrollHeight}px`;
    ta.style.width = `${Math.max(ta.scrollWidth, minWidth, 20)}px`;
  }

  /**
   * Height-only auto-size for the centered-label editor. The width is kept
   * fixed (matching the element's inner width) so the textarea wraps at exactly
   * the same place the canvas renderer does.
   */
  private autoSizeLabelTextarea(): void {
    const ta = this.textarea;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  private commitTextIfEditing(): void {
    if (!this.editingTextId || !this.textarea) return;
    const id = this.editingTextId;
    const text = this.textarea.value;
    this.editingTextId = null;
    this.removeTextarea();

    const el = this.deps.getElement(id) as TextElement | undefined;
    if (!el) return;

    if (text.trim() === "") {
      this.deps.removeElement(id);
    } else {
      const { width, height } = this.measureText(text, this.deps.getElementTextStyle(el));
      this.deps.updateElement(id, { text, width, height } as Partial<TextElement>);
    }
    this.deps.onTextCommitted();
  }

  private commitLabelIfEditing(): void {    if (!this.editingLabelId || !this.textarea) return;
    const id = this.editingLabelId;
    const text = this.textarea.value;
    this.editingLabelId = null;
    this.removeTextarea();

    const el = this.deps.getElement(id);
    if (!el) return;
    const style = this.deps.getElementLabelStyle(el);
    this.deps.updateElement(id, {
      label: text.trim() === "" ? undefined : text,
      ...this.textStyleToLabelPatch(style),
    });
    this.deps.onTextCommitted();
  }

  private positionLabelTextarea(el: BoardElement): void {    if (!this.textarea) return;
    const c = elementCenter(el);
    const screen = this.deps.camera.worldToScreen(c.x, c.y);
    const zoom = this.deps.camera.zoom;
    const style = this.deps.getElementLabelStyle(el);
    Object.assign(this.textarea.style, {
      left: `${screen.x}px`,
      top: `${screen.y}px`,
      fontSize: `${style.fontSize * zoom}px`,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      textAlign: style.textAlign,
      width: `${Math.max(40, (Math.abs(el.width) - 12) * zoom)}px`,
    });
    this.autoSizeLabelTextarea();
  }

  /**
   * Places the field exactly over the drawn name (to the left, above the
   * border), with the same font and size: entering edit mode moves nothing on
   * screen.
   */
  private positionFrameNameTextarea(el: FrameElement): void {
    const ta = this.textarea;
    if (!ta) return;
    const zoom = this.deps.camera.zoom;
    const fs = FRAME_NAME_FONT_SIZE;
    // `frameNameOrigin` returns the baseline; the field starts at the line top.
    const origin = frameNameOrigin(el);
    const screen = this.deps.camera.worldToScreen(origin.x, origin.y - fs);
    Object.assign(ta.style, {
      left: `${screen.x}px`,
      top: `${screen.y}px`,
      width: `${Math.max(Math.abs(el.width), fs * 6) * zoom}px`,
      height: `${fs * zoom * 1.3}px`,
      fontSize: `${fs * zoom}px`,
      fontFamily: DEFAULT_LABEL_STYLE.fontFamily,
      transformOrigin: "top left",
    });
  }

  private commitFrameNameIfEditing(): void {
    if (!this.editingFrameNameId || !this.textarea) return;
    const id = this.editingFrameNameId;
    // The name is a single line: pasting text with \n must not become a
    // multiline name.
    const name = this.textarea.value.replace(/\s*\n+\s*/g, " ").trim();
    this.editingFrameNameId = null;
    this.removeTextarea();

    const el = this.deps.getElement(id);
    if (!el) return;
    // `label` is cleared: keeping both filled in would let the old name come
    // back if the new one were deleted.
    this.deps.updateElement(id, { title: name, label: undefined } as Partial<BoardElement>);
    this.deps.onTextCommitted();
  }

  private textStyleToLabelPatch(style: Partial<TextStyle>): Partial<BoardElement> {
    const patch: Partial<BoardElement> = {};
    if (style.fontSize !== undefined) patch.labelFontSize = style.fontSize;
    if (style.fontFamily !== undefined) patch.labelFontFamily = style.fontFamily;
    if (style.fontWeight !== undefined) patch.labelFontWeight = style.fontWeight;
    if (style.fontStyle !== undefined) patch.labelFontStyle = style.fontStyle;
    if (style.textAlign !== undefined) patch.labelTextAlign = style.textAlign;
    if (style.verticalAlign !== undefined) patch.labelVerticalAlign = style.verticalAlign;
    return patch;
  }
}
