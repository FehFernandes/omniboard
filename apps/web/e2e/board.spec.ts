import { test, expect, type Page } from '@playwright/test';

// The product's critical path, in a real browser: draw, reload, and the work is
// still there. It is the flow that loses the user's work when it breaks — and the
// only one jsdom cannot exercise (real canvas plus real persistence).

/**
 * Closes the login invitation, if it is open.
 *
 * An anonymous visitor gets the modal on top of everything, and its backdrop
 * intercepts pointer events: NOTHING on the board is clickable before closing it —
 * including after every reload. Discovered by these tests; in jsdom no overlay
 * intercepts anything.
 */
async function fecharConviteDeLogin(page: Page) {
  const backdrop = page.locator('.login-backdrop');
  if (await backdrop.isVisible().catch(() => false)) {
    await page.locator('.login-modal .xbtn').click();
    await expect(backdrop).toBeHidden();
  }
}

/** Waits for the board to mount (canvas created by the lib) and autosave to be up. */
async function openBoard(page: Page) {
  await page.goto('/');
  await expect(page.locator('#board canvas')).toBeVisible();
  // The tool island appearing means the imperative hydration finished.
  await expect(page.locator('#toolbar')).toBeVisible();
  await fecharConviteDeLogin(page);
}

/** Reloads and returns the board ready for interaction. */
async function reload(page: Page) {
  await page.reload();
  await expect(page.locator('#board canvas')).toBeVisible();
  await fecharConviteDeLogin(page);
}

/** Desenha arrastando no canvas, em coordenadas relativas a ele. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const canvas = page.locator('#board canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  // Intermediate steps: the board decides "drag" vs "click" by distance.
  await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
}

/** Number of elements on the active board, read from localStorage (the source of truth). */
async function countElements(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('omniboard-ws');
    if (!raw) return 0;
    const env = JSON.parse(raw);
    const ws = env.workspace ?? env;
    const doc = ws.documents?.find((d: { id: string }) => d.id === ws.activeId) ?? ws.documents?.[0];
    return doc?.snapshot?.elements?.length ?? 0;
  });
}

test.beforeEach(async ({ page }) => {
  // Every test starts from a clean board.
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
});

test('draws a rectangle and it survives a reload', async ({ page }) => {
  await openBoard(page);
  expect(await countElements(page)).toBe(0);

  await page.locator('#toolbar [data-tool="rectangle"]').click();
  await drag(page, { x: 250, y: 200 }, { x: 480, y: 360 });

  // The save badge is the promise the product makes to the user.
  await expect(page.locator('#saveState .txt')).toHaveText(/^saved$/, { timeout: 15_000 });
  expect(await countElements(page)).toBe(1);

  await reload(page);
  expect(await countElements(page)).toBe(1);
});

test('several elements and tools persist together', async ({ page }) => {
  await openBoard(page);

  await page.locator('#toolbar [data-tool="rectangle"]').click();
  await drag(page, { x: 200, y: 160 }, { x: 340, y: 260 });

  await page.locator('#toolbar [data-tool="ellipse"]').click();
  await drag(page, { x: 420, y: 160 }, { x: 560, y: 260 });

  await page.locator('#toolbar [data-tool="freedraw"]').click();
  await drag(page, { x: 220, y: 380 }, { x: 520, y: 460 });

  await expect(page.locator('#saveState .txt')).toHaveText(/^saved$/, { timeout: 15_000 });
  expect(await countElements(page)).toBe(3);

  await reload(page);
  expect(await countElements(page)).toBe(3);
});

test('a comment created on the board survives a reload', async ({ page }) => {
  await openBoard(page);

  await page.locator('#comment').click();
  const box = (await page.locator('#board canvas').boundingBox())!;
  await page.mouse.click(box.x + 400, box.y + 300);

  const field = page.getByLabel('Write a comment');
  await expect(field).toBeVisible();
  await field.fill('review this flow');
  await page.getByLabel('Send').click();

  // The pin shows the author's initial.
  await expect(page.locator('.comment-pin')).toBeVisible();

  await reload(page);
  const pin = page.locator('.comment-pin');
  await expect(pin).toBeVisible({ timeout: 15_000 });

  // And hovering shows the text without having to open it.
  await pin.hover();
  await expect(page.locator('.comment-peek')).toContainText('review this flow');
});

test('undo reverts what was drawn', async ({ page }) => {
  await openBoard(page);

  await page.locator('#toolbar [data-tool="rectangle"]').click();
  await drag(page, { x: 250, y: 200 }, { x: 420, y: 320 });
  // The save is debounced: poll for the number instead of reading it immediately.
  await expect.poll(() => countElements(page), { timeout: 10_000 }).toBe(1);

  await page.locator('#undo').click();
  await expect.poll(() => countElements(page), { timeout: 10_000 }).toBe(0);
});

test('the note opens the modal and the text lands on the board', async ({ page }) => {
  await openBoard(page);

  await page.locator('#toolbar [data-tool="note"]').click();
  const box = (await page.locator('#board canvas').boundingBox())!;
  await page.mouse.click(box.x + 400, box.y + 300);

  const body = page.getByLabel('Note content');
  await expect(body).toBeVisible();
  await body.fill('thursday meeting minutes');
  await page.getByLabel('Close').click();

  await expect(page.locator('#saveState .txt')).toHaveText(/^saved$/, { timeout: 15_000 });

  await reload(page);
  const text = await page.evaluate(() => localStorage.getItem('omniboard-ws') ?? '');
  expect(text).toContain('thursday meeting minutes');
});

test('an invalid shared-board page explains what happened', async ({ page }) => {
  // Nonexistent token: the page has to say so, not go blank.
  await page.goto('/b/token-that-does-not-exist-but-is-long-enough');
  await expect(page.locator('.shared-error')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.shared-error')).toContainText(/unavailable|no longer exists/i);
});

test('legal pages open on their own (required by Google OAuth)', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.locator('h1')).toContainText(/privacy/i);

  await page.goto('/terms');
  await expect(page.locator('h1')).toContainText(/terms/i);

  // The Portuguese alias redirects.
  await page.goto('/privacidade');
  await expect(page.locator('h1')).toContainText(/privacy/i);
});
