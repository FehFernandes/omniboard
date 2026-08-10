import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { BoardNoteModal, countWords, type NoteBoardLike } from './board-note-modal';
import type { BoardElement } from '@omniboard/react';

/**
 * Board double: it keeps elements in a Map and fires `elementActivate` on
 * command — that is how the canvas reports that the note was activated.
 */
function fakeBoard(elementos: BoardElement[] = []) {
  const map = new Map(elementos.map((e) => [e.id, { ...e }]));
  const listeners = new Set<(e: unknown) => void>();
  const removed: string[] = [];

  const board: NoteBoardLike & {
    activate: (id: string, reason?: string) => void;
    removed: string[];
    read: (id: string) => Record<string, unknown>;
  } = {
    getElement: (id) => map.get(id),
    updateElement: (id, patch) => {
      const current = map.get(id);
      if (current) map.set(id, { ...current, ...patch } as BoardElement);
    },
    removeElement: (id) => {
      removed.push(id);
      map.delete(id);
    },
    on: (_type, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activate: (id, reason = 'click') => {
      const el = map.get(id);
      act(() => {
        listeners.forEach((l) => l({ type: 'elementActivate', element: el, reason }));
      });
    },
    removed,
    read: (id) => map.get(id) as unknown as Record<string, unknown>,
  };
  return board;
}

const note = (extra: Record<string, unknown> = {}): BoardElement =>
  ({
    id: 'n1',
    type: 'note',
    x: 0, y: 0, width: 260, height: 200, angle: 0, version: 1,
    strokeColor: '#000', backgroundColor: '#fff', fillStyle: 'solid',
    strokeWidth: 1, opacity: 1,
    title: '', text: '', color: '#f59e0b',
    ...extra,
  }) as BoardElement;

describe('note modal', () => {
  beforeEach(() => cleanup());

  it('only opens when the board activates the note', () => {
    const board = fakeBoard([note()]);
    render(<BoardNoteModal board={board} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    board.activate('n1');
    expect(screen.getByRole('dialog', { name: 'Note' })).toBeTruthy();
  });

  it('shows the existing content and writes the edit into the element', () => {
    const board = fakeBoard([note({ title: 'Minutes', text: 'old text' })]);
    render(<BoardNoteModal board={board} />);
    board.activate('n1');

    const title = screen.getByLabelText('Note title') as HTMLInputElement;
    const body = screen.getByLabelText('Note content') as HTMLTextAreaElement;
    expect(title.value).toBe('Minutes');
    expect(body.value).toBe('old text');

    fireEvent.change(body, { target: { value: 'thursday meeting\nsecond line' } });
    fireEvent.click(screen.getByLabelText('Close'));

    expect(board.read('n1').text).toBe('thursday meeting\nsecond line');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The text is long by definition: losing it when closing in any way is the
  // worst possible outcome.
  it('saves with Escape and on unmount (board switch)', () => {
    const board = fakeBoard([note({ title: 'A' })]);
    const { unmount } = render(<BoardNoteModal board={board} />);

    board.activate('n1');
    fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'with esc' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(board.read('n1').text).toBe('with esc');

    board.activate('n1');
    fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'on unmount' } });
    unmount();
    expect(board.read('n1').text).toBe('on unmount');
  });

  it('a click outside closes and saves', () => {
    const board = fakeBoard([note()]);
    render(<BoardNoteModal board={board} />);
    board.activate('n1');

    fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'clicked outside' } });
    fireEvent.pointerDown(document.querySelector('.note-backdrop')!);

    expect(board.read('n1').text).toBe('clicked outside');
  });

  it('a click inside the modal does not close it', () => {
    const board = fakeBoard([note()]);
    render(<BoardNoteModal board={board} />);
    board.activate('n1');

    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeTruthy();
  });

  it('a note created and abandoned blank is discarded', () => {
    const board = fakeBoard([note()]);
    render(<BoardNoteModal board={board} />);

    board.activate('n1', 'create');
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(board.removed).toEqual(['n1']);
  });

  it('a note created WITH content is kept', () => {
    const board = fakeBoard([note()]);
    render(<BoardNoteModal board={board} />);

    board.activate('n1', 'create');
    fireEvent.change(screen.getByLabelText('Note content'), { target: { value: 'something' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(board.removed).toEqual([]);
    expect(board.read('n1').text).toBe('something');
  });

  it('changes the stripe color', () => {
    const board = fakeBoard([note()]);
    render(<BoardNoteModal board={board} />);
    board.activate('n1');

    fireEvent.click(screen.getByLabelText('Cor #3b82f6'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(board.read('n1').color).toBe('#3b82f6');
  });

  it('deleting removes the element and closes', () => {
    const board = fakeBoard([note({ text: 'x' })]);
    render(<BoardNoteModal board={board} />);
    board.activate('n1');

    fireEvent.click(screen.getByLabelText('Delete note'));
    expect(board.removed).toEqual(['n1']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores elements that are not notes', () => {
    const board = fakeBoard([{ ...note(), type: 'rectangle' } as BoardElement]);
    render(<BoardNoteModal board={board} />);
    board.activate('n1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('counts words to give a sense of the size', () => {
    expect(countWords('')).toBe('0 words');
    expect(countWords('  one  ')).toBe('1 word');
    expect(countWords('three words here')).toBe('3 words');
  });
});
