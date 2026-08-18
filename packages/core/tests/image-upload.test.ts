import { describe, it, expect, vi, beforeAll } from "vitest";
import { ImageManager } from "../src/ImageManager";

/**
 * What these tests protect: a pasted image must NOT become a data URL inside the
 * element when a storage exists. The board snapshot is saved in full on every
 * change — base64 in there travels on every save and blows past the API body
 * limit. With `uploadImage`, the element keeps only the URL.
 */

// The lib runner runs on Node (no DOM). FileReader and Image are the only browser
// pieces ImageManager uses; a minimal stub avoids dragging jsdom in here.
beforeAll(() => {
  if (typeof globalThis.FileReader === "undefined") {
    class FileReaderStub {
      result: string | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(file: File) {
        void file.arrayBuffer().then((buf) => {
          const b64 = Buffer.from(buf).toString("base64");
          this.result = `data:${file.type};base64,${b64}`;
          this.onload?.();
        });
      }
    }
    (globalThis as Record<string, unknown>).FileReader = FileReaderStub;
  }
  if (typeof globalThis.Image === "undefined") {
    class ImageStub {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
    }
    (globalThis as Record<string, unknown>).Image = ImageStub;
  }
});

function setup(uploadImage?: (f: File) => Promise<string>) {
  const added: string[] = [];
  const erros: unknown[] = [];
  const mgr = new ImageManager({
    getElements: () => [],
    addImage: (src) => {
      added.push(src);
      return "id";
    },
    markDirty: () => {},
    uploadImage,
    onUploadError: (err) => erros.push(err),
  });
  return { mgr, added, erros };
}

const file = () => new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" });

/** jsdom's FileReader is asynchronous: waits for the data URL to show up. */
async function aguardar(cond: () => boolean, tentativas = 50): Promise<void> {
  for (let i = 0; i < tentativas && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("ImageManager — upload to storage", () => {
  it("with an uploader, keeps the URL and does not embed base64", async () => {
    const upload = vi.fn(async () => "https://cdn.exemplo.com/u/1/abc.png");
    const { mgr, added } = setup(upload);

    mgr.addImageFromFile(file(), { x: 10, y: 20 });
    await aguardar(() => added.length > 0);

    expect(upload).toHaveBeenCalledOnce();
    expect(added).toEqual(["https://cdn.exemplo.com/u/1/abc.png"]);
    expect(added[0]).not.toContain("base64");
  });

  it("without an uploader, keeps the old behavior (data URL)", async () => {
    const { mgr, added } = setup();

    mgr.addImageFromFile(file());
    await aguardar(() => added.length > 0);

    expect(added[0].startsWith("data:image/png;base64,")).toBe(true);
  });

  // Storage being down must not cost the image the user has just pasted.
  it("upload failure embeds the image and reports it", async () => {
    const upload = vi.fn(async () => {
      throw new Error("bucket fora do ar");
    });
    const { mgr, added, erros } = setup(upload);

    mgr.addImageFromFile(file());
    await aguardar(() => added.length > 0);

    expect(added[0].startsWith("data:")).toBe(true);
    expect(erros).toHaveLength(1);
    expect((erros[0] as Error).message).toBe("bucket fora do ar");
  });

  it("an empty URL from the uploader also falls back to embedded", async () => {
    const { mgr, added } = setup(async () => "");

    mgr.addImageFromFile(file());
    await aguardar(() => added.length > 0);

    expect(added[0].startsWith("data:")).toBe(true);
  });

  it("image cache is idempotent per src", () => {
    const { mgr } = setup();
    mgr.ensureImage("https://cdn.exemplo.com/a.png");
    mgr.ensureImage("https://cdn.exemplo.com/a.png");
    expect(mgr.getCache().size).toBe(1);
  });
});
