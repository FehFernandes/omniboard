import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
  BoardLinkPicker,
  type LinkBoardLike,
  type LinkManagerLike,
} from './board-link-picker';
import type { BoardElement } from '@omniboard/react';

function fakeBoard(elementos: BoardElement[]) {
  const map = new Map(elementos.map((e) => [e.id, { ...e }]));
  const listeners = new Set<(e: unknown) => void>();
  const removed: string[] = [];

  return {
    getElement: (id: string) => map.get(id),
    updateElement: (id: string, patch: Partial<BoardElement>) => {
      const current = map.get(id);
      if (current) map.set(id, { ...current, ...patch } as BoardElement);
    },
    removeElement: (id: string) => {
      removed.push(id);
      map.delete(id);
    },
    on: (_t: 'elementActivate', l: (e: unknown) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    activate: (id: string, reason = 'click') => {
      const el = map.get(id);
      act(() => {
        listeners.forEach((l) => l({ type: 'elementActivate', element: el, reason }));
      });
    },
    read: (id: string) => map.get(id) as unknown as Record<string, unknown>,
    removed,
  } satisfies LinkBoardLike & Record<string, unknown>;
}

function fakeManager(docs: { id: string; name: string }[], activeId = docs[0]?.id ?? '') {
  const swaps: string[] = [];
  const manager: LinkManagerLike & { swaps: string[] } = {
    list: () => [...docs],
    getActiveId: () => activeId,
    switch: (id) => {
      swaps.push(id);
      activeId = id;
    },
    swaps,
  };
  return manager;
}

const shortcut = (extra: Record<string, unknown> = {}): BoardElement =>
  ({
    id: 'l1',
    type: 'link',
    x: 0, y: 0, width: 240, height: 72, angle: 0, version: 1,
    strokeColor: '#4f46e5', backgroundColor: '#eef2ff', fillStyle: 'solid',
    strokeWidth: 1.5, opacity: 1,
    ...extra,
  }) as BoardElement;

describe('shortcut between boards', () => {
  beforeEach(() => cleanup());

  it('a shortcut without a target opens the picker with the other boards', () => {
    const board = fakeBoard([shortcut()]);
    const manager = fakeManager([
      { id: 'b1', name: 'Atual' },
      { id: 'b2', name: 'Arquitetura' },
    ]);
    render(<BoardLinkPicker board={board} manager={manager} />);

    board.activate('l1');

    expect(screen.getByRole('dialog', { name: /target board/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arquitetura' })).toBeTruthy();
    // The current board does not show up: a shortcut to itself makes no sense.
    expect(screen.queryByRole('button', { name: 'Atual' })).toBeNull();
  });

  it('picking the target saves id and name and navigates on the next clicks', () => {
    const board = fakeBoard([shortcut()]);
    const manager = fakeManager([
      { id: 'b1', name: 'Atual' },
      { id: 'b2', name: 'Arquitetura' },
    ]);
    const onNavigate = vi.fn();
    render(<BoardLinkPicker board={board} manager={manager} onNavigate={onNavigate} />);

    board.activate('l1');
    fireEvent.click(screen.getByRole('button', { name: 'Arquitetura' }));

    expect(board.read('l1').targetId).toBe('b2');
    expect(board.read('l1').label).toBe('Arquitetura');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(manager.swaps).toEqual([]);
  });

  // The whole point of the element: with a target set, activating navigates — it
  // does not open a menu.
  it('a configured shortcut navigates straight away', () => {
    const board = fakeBoard([shortcut({ targetId: 'b2', label: 'Arquitetura' })]);
    const manager = fakeManager([
      { id: 'b1', name: 'Atual' },
      { id: 'b2', name: 'Arquitetura' },
    ]);
    const onNavigate = vi.fn();
    render(<BoardLinkPicker board={board} manager={manager} onNavigate={onNavigate} />);

    board.activate('l1');

    expect(manager.swaps).toEqual(['b2']);
    expect(onNavigate).toHaveBeenCalledWith('Arquitetura');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('updates the label when the target board was renamed', () => {
    const board = fakeBoard([shortcut({ targetId: 'b2', label: 'Old name' })]);
    const manager = fakeManager([
      { id: 'b1', name: 'Atual' },
      { id: 'b2', name: 'New name' },
    ]);
    render(<BoardLinkPicker board={board} manager={manager} />);

    board.activate('l1');

    expect(board.read('l1').label).toBe('New name');
    expect(manager.swaps).toEqual(['b2']);
  });

  it('a deleted target warns and reopens the picker', () => {
    const board = fakeBoard([shortcut({ targetId: 'sumiu', label: 'Removido' })]);
    const manager = fakeManager([
      { id: 'b1', name: 'Atual' },
      { id: 'b2', name: 'Other' },
    ]);
    const onMissing = vi.fn();
    render(<BoardLinkPicker board={board} manager={manager} onMissing={onMissing} />);

    board.activate('l1');

    expect(onMissing).toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(manager.swaps).toEqual([]);
  });

  it('a shortcut to the current board does not navigate, it only warns', () => {
    const board = fakeBoard([shortcut({ targetId: 'b1', label: 'Atual' })]);
    const manager = fakeManager([{ id: 'b1', name: 'Atual' }]);
    const onNavigate = vi.fn();
    render(<BoardLinkPicker board={board} manager={manager} onNavigate={onNavigate} />);

    board.activate('l1');

    expect(manager.swaps).toEqual([]);
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('already on'));
  });

  it('a shortcut created and abandoned without a target is discarded', () => {
    const board = fakeBoard([shortcut()]);
    const manager = fakeManager([
      { id: 'b1', name: 'Atual' },
      { id: 'b2', name: 'Other' },
    ]);
    render(<BoardLinkPicker board={board} manager={manager} />);

    board.activate('l1', 'create');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(board.removed).toEqual(['l1']);
  });

  it('an already existing shortcut that is cancelled stays on the board', () => {
    const board = fakeBoard([shortcut()]);
    const manager = fakeManager([
      { id: 'b1', name: 'Atual' },
      { id: 'b2', name: 'Other' },
    ]);
    render(<BoardLinkPicker board={board} manager={manager} />);

    board.activate('l1', 'click');
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(board.removed).toEqual([]);
  });

  it('a single board explains why there is no target', () => {
    const board = fakeBoard([shortcut()]);
    const manager = fakeManager([{ id: 'b1', name: 'Only one' }]);
    render(<BoardLinkPicker board={board} manager={manager} />);

    board.activate('l1');

    expect(screen.getByText(/only board/i)).toBeTruthy();
  });

  it('ignores elements that are not shortcuts', () => {
    const board = fakeBoard([{ ...shortcut(), type: 'note' } as BoardElement]);
    const manager = fakeManager([{ id: 'b1', name: 'A' }, { id: 'b2', name: 'B' }]);
    render(<BoardLinkPicker board={board} manager={manager} />);

    board.activate('l1');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(manager.swaps).toEqual([]);
  });
});
