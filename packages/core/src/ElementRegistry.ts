/**
 * ElementRegistry — Manages element type definitions and dispatches
 * create/hitTest/render/normalize operations to the registered definition.
 *
 * Implements the ElementRegistry interface from plugin-types.ts.
 *
 * Built-in element types are registered by default. External plugins can
 * register additional element types.
 */

import type { ElementDefinition, ElementRegistry, ElementRenderContext } from "./plugin-types";
import type { BoardElement, ElementStyle, ElementType, Point } from "./types";
import { createElement as builtinCreate, hitTestElement as builtinHitTest, normalizeElement as builtinNormalize } from "./elements";

/**
 * Built-in element types that are handled by the existing createElement/
 * hitTestElement/normalizeElement functions. The registry delegates to those
 * functions for these types.
 */
const BUILTIN_TYPES: ReadonlySet<string> = new Set<string>([
  "rectangle",
  "ellipse",
  "line",
  "arrow",
  "freedraw",
  "text",
  "image",
  "embed",
  "tasks",
  "shape",
  "sticky",
  "frame",
  "link",
  "note",
]);

export class ElementRegistryImpl implements ElementRegistry {
  private definitions = new Map<string, ElementDefinition>();

  register<T extends BoardElement>(def: ElementDefinition<T>): void {
    this.definitions.set(def.type, def as ElementDefinition);
  }

  unregister(type: string): void {
    this.definitions.delete(type);
  }

  get(type: string): ElementDefinition | undefined {
    return this.definitions.get(type);
  }

  getAll(): ElementDefinition[] {
    return [...this.definitions.values()];
  }

  /**
   * Create an element of the given type.
   * For built-in types, delegates to the existing createElement.
   * For plugin-registered types, uses the definition's create method.
   */
  create(
    type: string,
    props: Partial<BoardElement> & { x: number; y: number },
    style: Partial<ElementStyle> = {},
  ): BoardElement {
    if (BUILTIN_TYPES.has(type)) {
      return builtinCreate(type as ElementType, props, style);
    }
    const def = this.definitions.get(type);
    if (!def) {
      throw new Error(`Unknown element type: ${type}. Did you forget to register it?`);
    }
    return def.create(props, style);
  }

  /**
   * Hit test an element at a world point.
   * For built-in types, delegates to the existing hitTestElement.
   * For plugin-registered types, uses the definition's hitTest method.
   */
  hitTest(el: BoardElement, point: Point, threshold: number): boolean {
    if (BUILTIN_TYPES.has(el.type)) {
      return builtinHitTest(el, point, threshold);
    }
    const def = this.definitions.get(el.type);
    if (!def) return false;
    return def.hitTest(el, point, threshold);
  }

  /**
   * Normalize an element (fix negative width/height, etc).
   * For built-in types, delegates to the existing normalizeElement.
   * For plugin-registered types, uses the definition's normalize if provided.
   */
  normalize(el: BoardElement): BoardElement {
    if (BUILTIN_TYPES.has(el.type)) {
      return builtinNormalize(el);
    }
    const def = this.definitions.get(el.type);
    if (def?.normalize) return def.normalize(el);
    return builtinNormalize(el); // Fallback to generic normalization
  }

  /**
   * Render an element using its definition.
   * Only available for plugin-registered types — built-in rendering is
   * handled by the CanvasRenderer directly for performance.
   */
  render(el: BoardElement, ctx: ElementRenderContext): void {
    const def = this.definitions.get(el.type);
    if (def) {
      def.render(el, ctx);
    }
  }

  /**
   * Get the bounding box of an element via its definition.
   * Returns undefined if no custom getBounds is registered.
   */
  getBounds(el: BoardElement): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
    const def = this.definitions.get(el.type);
    return def?.getBounds?.(el);
  }

  /**
   * Check if a type is registered (either built-in or plugin).
   */
  has(type: string): boolean {
    return BUILTIN_TYPES.has(type) || this.definitions.has(type);
  }

  /**
   * Get all registered type names (built-in + plugin).
   */
  getTypes(): string[] {
    return [...BUILTIN_TYPES, ...this.definitions.keys()];
  }
}
