import type { Point } from "./types";

/**
 * Uploads the file to an external storage, when the app has one.
 *
 * Without it the image only exists as a data URL inside the element — that is,
 * inside the board snapshot. A few large files and the whole snapshot (which is
 * saved in full on every change) goes past any request limit. With the hook, the
 * board keeps a short and stable URL, and the binary lives in the bucket.
 *
 * It must return the final public URL. Throwing makes the board fall back to the
 * embedded mode (the user does not lose the image because storage is down).
 */
export type ImageUploader = (file: File) => Promise<string>;

export interface ImageManagerDeps {
  getElements: () => { type: string; src?: string }[];
  addImage: (src: string, opts: { position?: Point }) => string;
  markDirty: () => void;
  /** External upload (optional). See {@link ImageUploader}. */
  uploadImage?: ImageUploader;
  /** Tells the app the upload failed and the image was embedded instead. */
  onUploadError?: (err: unknown, file: File) => void;
}

export class ImageManager {
  private imageCache = new Map<string, HTMLImageElement>();
  private deps: ImageManagerDeps;

  constructor(deps: ImageManagerDeps) {
    this.deps = deps;
  }

  getCache(): Map<string, HTMLImageElement> {
    return this.imageCache;
  }

  /** Start loading an image into the cache (idempotent). */
  ensureImage(src: string): void {
    if (!src || this.imageCache.has(src)) return;
    const img = new Image();
    img.onload = () => this.deps.markDirty();
    img.onerror = () => this.deps.markDirty();
    img.src = src;
    this.imageCache.set(src, img);
  }

  /** Ensure all image elements in the scene have their src loaded into cache. */
  preloadImages(): void {
    for (const el of this.deps.getElements()) {
      if (el.type === "image" && el.src) this.ensureImage(el.src);
    }
  }

  /** Open a file picker and add the chosen image(s) at `position`. */
  promptImageFileAt(position: Point): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files) : [];
      let i = 0;
      for (const f of files) {
        if (f.type.startsWith("image/")) {
          this.addImageFromFile(f, {
            x: position.x + i * 16,
            y: position.y + i * 16,
          });
          i++;
        }
      }
      input.remove();
    });
    input.addEventListener("cancel", () => input.remove());
    input.click();
  }

  /**
   * Adds a file as an image element.
   *
   * With `uploadImage` configured, it uploads to the storage and keeps the URL.
   * If the upload fails, it falls back to a data URL: worse for the snapshot
   * size, but the user does not lose what was just pasted.
   */
  addImageFromFile(file: File, position?: Point): void {
    const { uploadImage } = this.deps;
    if (!uploadImage) {
      this.addEmbedded(file, position);
      return;
    }
    void uploadImage(file)
      .then((url) => {
        if (url) this.deps.addImage(url, { position });
        else this.addEmbedded(file, position);
      })
      .catch((err) => {
        this.deps.onUploadError?.(err, file);
        this.addEmbedded(file, position);
      });
  }

  /** Reads the file as a data URL and adds it (embedded mode). */
  private addEmbedded(file: File, position?: Point): void {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        this.deps.addImage(reader.result, { position });
      }
    };
    reader.readAsDataURL(file);
  }

  destroy(): void {
    this.imageCache.clear();
  }
}
