import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { BoardComments, type CommentBoardLike } from './board-comments';
import { CommentStore } from '../lib/boards/comments';
import { unwrapWorkspace, wrapWorkspace } from '../lib/boards/board-meta';

// Board double: the overlay only uses the camera and the camera event.
function fakeBoard(): CommentBoardLike {
  return {
    camera: {
      worldToScreen: (x: number, y: number) => ({ x, y }),
      screenToWorld: (x: number, y: number) => ({ x, y }),
    },
    on: () => () => {},
  };
}

/** The board's canvas, which the overlay looks up as `#board canvas`. */
function mountCanvas(): HTMLCanvasElement {
  document.querySelectorAll('#board').forEach((n) => n.remove());
  const host = document.createElement('div');
  host.id = 'board';
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  host.appendChild(canvas);
  document.body.appendChild(host);
  return canvas;
}

function clickOnCanvas(canvas: HTMLCanvasElement, x = 40, y = 60) {
  act(() => {
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
  });
}

interface Scenario {
  store: CommentStore;
  canvas: HTMLCanvasElement;
  onDone: ReturnType<typeof vi.fn>;
  render: (active: boolean) => void;
}

function scenario(store = new CommentStore()): Scenario {
  const canvas = mountCanvas();
  const onDone = vi.fn();
  const board = fakeBoard();
  const draw = (active: boolean) =>
    render(
      <BoardComments
        board={board}
        store={store}
        boardId="b1"
        author="Ana"
        active={active}
        onDone={onDone}
      />,
    );
  return { store, canvas, onDone, render: draw };
}

describe('BoardComments', () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('creates the pin on click and saves the submitted text', () => {
    const c = scenario();
    c.render(true);
    clickOnCanvas(c.canvas);

    expect(c.store.list('b1')).toHaveLength(1);
    expect(c.onDone).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Write a comment'), {
      target: { value: 'revisar este fluxo' },
    });
    fireEvent.click(screen.getByLabelText('Send'));

    expect(c.store.list('b1')[0].text).toBe('revisar este fluxo');
  });

  // Regression: close() used to discard the draft and delete the new pin, i.e.
  // typing and closing (Esc/X/click outside) lost the comment.
  it('saves the draft when closing through the X instead of discarding it', () => {
    const c = scenario();
    c.render(true);
    clickOnCanvas(c.canvas);

    fireEvent.change(screen.getByLabelText('Write a comment'), {
      target: { value: 'do not lose me' },
    });
    fireEvent.click(screen.getByLabelText('Close'));

    expect(c.store.list('b1')).toHaveLength(1);
    expect(c.store.list('b1')[0].text).toBe('do not lose me');
  });

  it('saves the draft when closing with Escape', () => {
    const c = scenario();
    c.render(true);
    clickOnCanvas(c.canvas);

    fireEvent.change(screen.getByLabelText('Write a comment'), {
      target: { value: 'written with esc' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(c.store.list('b1')[0].text).toBe('written with esc');
  });

  it('saves the draft when clicking outside the popover', () => {
    const c = scenario();
    c.render(true);
    clickOnCanvas(c.canvas);

    fireEvent.change(screen.getByLabelText('Write a comment'), {
      target: { value: 'clicou fora' },
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(c.store.list('b1')[0].text).toBe('clicou fora');
  });

  it('saves the draft on unmount (board switch)', () => {
    const c = scenario();
    c.render(true);
    clickOnCanvas(c.canvas);

    fireEvent.change(screen.getByLabelText('Write a comment'), {
      target: { value: 'trocou de board' },
    });
    cleanup();

    expect(c.store.list('b1')[0].text).toBe('trocou de board');
  });

  it('discards a pin closed without any text', () => {
    const c = scenario();
    c.render(true);
    clickOnCanvas(c.canvas);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(c.store.list('b1')).toHaveLength(0);
  });

  it('a draft on an existing comment becomes a reply', () => {
    const store = new CommentStore({
      b1: [{ id: 'c1', x: 0, y: 0, text: 'original', author: 'Ana', createdAt: 1 }],
    });
    const c = scenario(store);
    c.render(false);

    fireEvent.click(screen.getByLabelText(/Comment by Ana/));
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'concordo' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(store.list('b1')[0].replies).toHaveLength(1);
    expect(store.list('b1')[0].replies?.[0].text).toBe('concordo');
  });

  it('uses no emoji in the pin: the icon is SVG', () => {
    const store = new CommentStore({
      b1: [{ id: 'c1', x: 0, y: 0, text: 'hi', author: 'Ana', createdAt: 1 }],
    });
    const c = scenario(store);
    c.render(false);

    const pin = screen.getByLabelText(/Comment by Ana/);
    // Author initial instead of an emoji: it identifies who commented.
    expect(pin.textContent).toBe('A');
    expect(pin.querySelector('svg')).toBeNull();
  });

  // Reading a comment should not require a click.
  it('hover shows a preview with author, text and number of replies', () => {
    const store = new CommentStore({
      b1: [
        {
          id: 'c1', x: 0, y: 0, text: 'revisar este fluxo', author: 'Ana', createdAt: Date.now(),
          replies: [{ id: 'r1', text: 'ok', author: 'Bruno', createdAt: Date.now() }],
        },
      ],
    });
    const c = scenario(store);
    c.render(false);

    const anchor = document.querySelector('.comment-anchor')!;
    expect(document.querySelector('.comment-peek')).toBeNull();

    fireEvent.mouseEnter(anchor);
    const peek = document.querySelector('.comment-peek')!;
    expect(peek).toBeTruthy();
    expect(peek.textContent).toContain('revisar este fluxo');
    expect(peek.textContent).toContain('Ana');
    expect(peek.textContent).toContain('1 reply');

    fireEvent.mouseLeave(anchor);
    expect(document.querySelector('.comment-peek')).toBeNull();
  });

  it('the preview does not show with the thread open (nor duplicate the text)', () => {
    const store = new CommentStore({
      b1: [{ id: 'c1', x: 0, y: 0, text: 'some text', author: 'Ana', createdAt: 1 }],
    });
    const c = scenario(store);
    c.render(false);

    const anchor = document.querySelector('.comment-anchor')!;
    fireEvent.mouseEnter(anchor);
    fireEvent.click(screen.getByLabelText(/Comment by Ana/));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelector('.comment-peek')).toBeNull();
  });

  it('a pin without text has no preview to show yet', () => {
    const c = scenario();
    c.render(true);
    clickOnCanvas(c.canvas);

    fireEvent.mouseEnter(document.querySelector('.comment-anchor')!);
    expect(document.querySelector('.comment-peek')).toBeNull();
  });

  it('the pin counts the replies and marks resolved', () => {
    const store = new CommentStore({
      b1: [
        {
          id: 'c1', x: 0, y: 0, text: 'a', author: 'Ana', createdAt: 1,
          replies: [
            { id: 'r1', text: 'b', author: 'Bruno', createdAt: 2 },
            { id: 'r2', text: 'c', author: 'Ana', createdAt: 3 },
          ],
        },
      ],
    });
    const c = scenario(store);
    c.render(false);

    // 1 comment + 2 replies = 3.
    expect(document.querySelector('.comment-pin .badge')?.textContent).toBe('3');

    fireEvent.click(screen.getByLabelText(/Comment by Ana/));
    fireEvent.click(screen.getByLabelText('Mark as resolved'));

    // A resolved one goes out of sight until the user asks to show it.
    expect(document.querySelector('.comment-pin')).toBeNull();
    fireEvent.click(screen.getByText(/Show resolved \(1\)/));
    expect(document.querySelector('.comment-pin[data-resolved]')).toBeTruthy();
    // A resolved one swaps the counter for the check.
    expect(document.querySelector('.comment-pin .mark svg')).toBeTruthy();
  });

  it('survives the envelope save/reload cycle', () => {
    const c = scenario();
    let storage: unknown = null;
    c.store.subscribe(() => {
      storage = wrapWorkspace({ type: 'openboard-workspace' }, {}, [], c.store.all() as never);
    });

    c.render(true);
    clickOnCanvas(c.canvas);
    fireEvent.change(screen.getByLabelText('Write a comment'), {
      target: { value: 'persist this' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    cleanup();

    const { comments } = unwrapWorkspace(storage);
    const reloaded = new CommentStore(comments as never);
    expect(reloaded.list('b1')).toHaveLength(1);
    expect(reloaded.list('b1')[0].text).toBe('persist this');
  });
});
