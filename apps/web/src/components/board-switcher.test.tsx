import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { BoardSwitcher, type BoardManagerLike, type BoardManagerEventLike } from './board-switcher';
import { BoardMetaStore } from '../lib/boards/board-meta';

// BoardManager double: implements only what the panel uses (BoardManagerLike),
// avoiding mounting the @omniboard/core canvas in a DOM test.
function fakeManager(names: string[]) {
  let docs = names.map((name, i) => ({ id: `b${i}`, name }));
  let activeId = docs[0]?.id ?? '';
  const listeners = new Set<(e: BoardManagerEventLike) => void>();
  const emit = (type: string) =>
    listeners.forEach((fn) => fn({ type, documents: [...docs], activeId }));

  const manager: BoardManagerLike & { calls: string[] } = {
    calls: [],
    list: () => [...docs],
    getActiveId: () => activeId,
    create(name) {
      const id = `b${docs.length}`;
      docs = [...docs, { id, name: name ?? `Board ${docs.length + 1}` }];
      activeId = id;
      manager.calls.push('create');
      emit('documentsChange');
      return id;
    },
    switch(id) {
      activeId = id;
      manager.calls.push(`switch:${id}`);
      emit('activeChange');
    },
    rename(id, name) {
      docs = docs.map((d) => (d.id === id ? { ...d, name } : d));
      manager.calls.push(`rename:${id}:${name}`);
      emit('documentsChange');
    },
    remove(id) {
      docs = docs.filter((d) => d.id !== id);
      manager.calls.push(`remove:${id}`);
      emit('documentsChange');
    },
    duplicate(id) {
      manager.calls.push(`duplicate:${id}`);
      return 'novo';
    },
    on(_type, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return manager;
}

function setup(names = ['Architecture', 'Roadmap', 'Draft'], meta = new BoardMetaStore()) {
  const manager = fakeManager(names);

  // Reproduces the real structure: the component portals the trigger into the pill
  // row and the panel into the area it expands. Without that there is nowhere to
  // render.
  const container = document.createElement('div');
  container.className = 'pill pill-left';
  const trigger = document.createElement('span');
  const panel = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'pill-row';
  row.appendChild(trigger);
  container.append(row, panel);
  document.body.appendChild(container);

  const view = render(
    <BoardSwitcher
      manager={manager}
      metaStore={meta}
      triggerSlot={trigger}
      panelSlot={panel}
      container={container}
    />,
  );
  return { manager, meta, container, unmount: view.unmount };
}

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /manage boards/i }));

// testing-library's cleanup only unmounts React; the pills we create by hand would
// stay in the body and could duplicate query results across tests.
// The mode preference also has to be reset: it persists in localStorage.
afterEach(() => {
  document.querySelectorAll('.pill-left').forEach((el) => el.remove());
  localStorage.removeItem('omniboard-switcher-mode');
  document.body.style.removeProperty('--switcher-w');
});

// The active board's name also appears in the trigger, outside the panel. Scoping
// queries to the panel avoids matching it and getting a false positive.
const panel = () => screen.getByRole('dialog', { name: 'Boards' });
const inPanel = () => within(panel());
const expanded = () =>
  screen.getByRole('button', { name: /manage boards/i }).getAttribute('aria-expanded');

/** Filters moved from tabs into a menu behind the funnel, next to create-folder. */
const chooseFilter = (label: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name: 'Filter boards' }));
  fireEvent.click(within(screen.getByRole('listbox', { name: 'Filter boards' })).getByText(label));
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('BoardSwitcher', () => {
  it('shows the active board in the trigger', () => {
    setup();
    expect(screen.getByRole('button', { name: /manage boards/i }).textContent).toContain(
      'Architecture',
    );
  });

  // The panel stays mounted (to animate the exit), so "closed" has to be
  // observable through aria-expanded, not through the absence of the node.
  it('opens and closes the panel', () => {
    setup();
    const trigger = screen.getByRole('button', { name: /manage boards/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    openPanel();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('lists the boards and switches on click', () => {
    const { manager } = setup();
    openPanel();
    fireEvent.click(screen.getByText('Roadmap'));
    expect(manager.calls).toContain('switch:b1');
  });

  it('filters by search ignoring accents and case', () => {
    setup(['Architecture', 'Metrics']);
    openPanel();
    fireEvent.change(screen.getByLabelText('Search board'), { target: { value: 'metric' } });
    expect(inPanel().getByText('Metrics')).toBeTruthy();
    expect(inPanel().queryByText('Architecture')).toBeNull();
  });

  it('shows a notice when the search finds nothing', () => {
    setup();
    openPanel();
    fireEvent.change(screen.getByLabelText('Search board'), { target: { value: 'zzz' } });
    expect(screen.getByText('No board found')).toBeTruthy();
  });

  it('the Starred filter shows only the marked ones', () => {
    const meta = new BoardMetaStore({ b1: { starred: true } });
    setup(['Architecture', 'Roadmap'], meta);
    openPanel();
    chooseFilter(/starred/i);
    expect(inPanel().getByText('Roadmap')).toBeTruthy();
    expect(inPanel().queryByText('Architecture')).toBeNull();
  });

  it('the Recent filter uses the 7-day window', () => {
    const now = Date.now();
    const meta = new BoardMetaStore({
      b0: { updatedAt: now - 40 * 24 * 60 * 60 * 1000 }, // old entry
      b1: { updatedAt: now - 60 * 1000 }, // just now
    });
    setup(['Architecture', 'Roadmap'], meta);
    openPanel();
    chooseFilter(/recent/i);
    expect(inPanel().getByText('Roadmap')).toBeTruthy();
    expect(inPanel().queryByText('Architecture')).toBeNull();
  });

  // The tabs were removed: filtering lives in a menu, and the funnel signals when
  // a filter is active.
  it('no longer exposes filter tabs and marks the funnel while filtering', () => {
    setup();
    openPanel();
    expect(screen.queryByRole('tablist')).toBeNull();

    const funnel = screen.getByRole('button', { name: 'Filter boards' });
    expect(funnel.getAttribute('data-on')).toBeNull();

    chooseFilter(/starred/i);
    expect(screen.getByRole('button', { name: 'Filter boards' }).getAttribute('data-on')).toBe('true');
  });

  it('going back to All clears the filter', () => {
    const meta = new BoardMetaStore({ b1: { starred: true } });
    setup(['Architecture', 'Roadmap'], meta);
    openPanel();
    chooseFilter(/starred/i);
    expect(inPanel().queryByText('Architecture')).toBeNull();
    chooseFilter(/all/i);
    expect(inPanel().getByText('Architecture')).toBeTruthy();
  });

  // With drag & drop the order belongs to the user (position), so starred boards
  // are NOT reordered automatically anymore — forcing them to the top would fight
  // the drag. What marks a favorite is the star and the filter.
  it('respects the position order instead of promoting favorites', () => {
    const meta = new BoardMetaStore({
      b0: { position: 0 },
      b1: { position: 1 },
      b2: { position: 2, starred: true },
    });
    setup(['Architecture', 'Roadmap', 'Draft'], meta);
    openPanel();
    const names = inPanel()
      .getAllByText(/Architecture|Roadmap|Draft/)
      .map((el) => el.textContent);
    expect(names).toEqual(['Architecture', 'Roadmap', 'Draft']);
    // The star marks the favorite without touching the order.
    expect(inPanel().getByTitle('Starred')).toBeTruthy();
  });

  it('renames inline with Enter', () => {
    const { manager } = setup();
    openPanel();
    fireEvent.doubleClick(screen.getByText('Roadmap'));
    const input = screen.getByLabelText('Rename Roadmap');
    fireEvent.change(input, { target: { value: 'Roadmap 2027' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(manager.calls).toContain('rename:b1:Roadmap 2027');
  });

  it('Escape cancels the rename without closing the panel', () => {
    const { manager } = setup();
    openPanel();
    fireEvent.doubleClick(screen.getByText('Roadmap'));
    fireEvent.keyDown(screen.getByLabelText('Rename Roadmap'), { key: 'Escape' });
    expect(manager.calls.some((c) => c.startsWith('rename'))).toBe(false);
    expect(screen.getByRole('button', { name: /manage boards/i }).getAttribute('aria-expanded')).toBe('true');
  });

  it('creates a new board', () => {
    const { manager } = setup();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /new board/i }));
    expect(manager.calls).toContain('create');
  });

  it('duplicates through the actions menu', () => {
    const { manager } = setup();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /actions for Roadmap/i }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Duplicate'));
    expect(manager.calls).toContain('duplicate:b1');
  });

  it('stars through the actions menu', () => {
    const { manager: _m, meta } = setup();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /actions for Roadmap/i }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Star'));
    expect(meta.get('b1').starred).toBe(true);
  });

  // Deleting erases content: it has to go through a confirmation.
  it('only deletes after confirmation', () => {
    const { manager } = setup();
    openPanel();

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: /actions for Roadmap/i }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Delete'));
    expect(manager.calls.some((c) => c.startsWith('remove'))).toBe(false);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /actions for Roadmap/i }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Delete'));
    expect(manager.calls).toContain('remove:b1');
  });

  it('reacts to changes coming from the manager', () => {
    const { manager } = setup();
    openPanel();
    // A change fired outside a UI event: it needs act so React applies the state
    // before the assertion.
    act(() => manager.rename('b0', 'Renomeado por fora'));
    expect(inPanel().getByText('Renomeado por fora')).toBeTruthy();
  });

  // Coordination between islands: if another pill menu opens, this one closes.
  it('closes when another island announces it opened', () => {
    setup();
    openPanel();
    act(() => {
      window.dispatchEvent(new CustomEvent('omniboard:pill-menu-open', { detail: 'hamb' }));
    });
    expect(expanded()).toBe('false');
  });
});

describe('BoardSwitcher — pastas', () => {
  it('creates a folder through the inline form', () => {
    const { meta } = setup();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByLabelText('New folder name'), {
      target: { value: 'Studies' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));

    expect(meta.folders().map((f) => f.name)).toEqual(['Studies']);
    expect(inPanel().getByText('Studies')).toBeTruthy();
  });

  it('cancelling does not create a folder', () => {
    const { meta } = setup();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel new folder' }));
    expect(meta.folders()).toHaveLength(0);
  });

  it('shows the boards inside the folder and collapses on click', () => {
    const meta = new BoardMetaStore();
    const folder = meta.createFolder('Studies', null, 0);
    meta.patch('b1', { folderId: folder.id, position: 0 });
    setup(['Architecture', 'Roadmap'], meta);
    openPanel();

    // Expanded by default: the board inside shows up.
    expect(inPanel().getByText('Roadmap')).toBeTruthy();

    fireEvent.click(inPanel().getByText('Studies'));
    expect(inPanel().queryByText('Roadmap')).toBeNull();
  });

  it('renames a folder through the menu', () => {
    const meta = new BoardMetaStore();
    meta.createFolder('Studies', null, 0);
    setup(['Architecture'], meta);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Studies' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Rename'));
    const input = screen.getByLabelText('Rename Studies');
    fireEvent.change(input, { target: { value: 'Software Architecture' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(meta.folders()[0].name).toBe('Software Architecture');
  });

  // Deleting a folder is organization: the board inside moves up, nothing is erased.
  it('deleting a folder promotes its content without erasing boards', () => {
    const meta = new BoardMetaStore();
    const folder = meta.createFolder('Studies', null, 0);
    meta.patch('b1', { folderId: folder.id, position: 0 });
    const { manager } = setup(['Architecture', 'Roadmap'], meta);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Studies' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Delete folder'));

    expect(meta.folders()).toHaveLength(0);
    expect(meta.get('b1').folderId).toBeNull();
    expect(manager.calls.some((c) => c.startsWith('remove'))).toBe(false);
    expect(inPanel().getByText('Roadmap')).toBeTruthy();
  });

  it('creates a board inside the folder through the menu', () => {
    const meta = new BoardMetaStore();
    meta.createFolder('Studies', null, 0);
    const { manager } = setup(['Architecture'], meta);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Studies' }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('New board here'));

    expect(manager.calls).toContain('create');
    // The created board (b1, from the double) starts inside the folder.
    expect(meta.get('b1').folderId).toBe(meta.folders()[0].id);
  });

  // Search has to reveal results that live inside collapsed folders.
  it('search finds a board inside a collapsed folder', () => {
    const meta = new BoardMetaStore();
    const folder = meta.createFolder('Studies', null, 0);
    meta.toggleFolder(folder.id); // fecha
    meta.patch('b1', { folderId: folder.id, position: 0 });
    setup(['Architecture', 'Roadmap'], meta);
    openPanel();

    fireEvent.change(screen.getByLabelText('Search board'), { target: { value: 'roadmap' } });
    expect(inPanel().getByText('Roadmap')).toBeTruthy();
    expect(inPanel().getByText('Studies')).toBeTruthy();
  });
});

describe('BoardSwitcher — adaptive width', () => {
  const width = () => document.body.style.getPropertyValue('--switcher-w');

  /** jsdom does no layout: scrollWidth is always 0, so we fake it. */
  const stubTextWidth = (px: number) =>
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(px);

  it('publishes the width as a CSS variable on the body', () => {
    setup(['Architecture']);
    expect(width()).toMatch(/^\d+px$/);
  });

  // Floor: kept low because every pixel above the row's natural width becomes dead
  // space to the right of the chevron.
  it('respects the floor with a short title', () => {
    stubTextWidth(10);
    setup(['A']);
    expect(width()).toBe('152px');
  });

  // The hamburger bar and the docked sidebar have to match in width: both derive
  // from the SAME variable, and the CSS applies calc(var + 10px) to both.
  it('the same variable feeds both modes', () => {
    stubTextWidth(120);
    setup(['Architecture']);
    const before = width();

    fireEvent.click(screen.getByRole('button', { name: /manage boards/i }));
    fireEvent.click(screen.getByRole('button', { name: /side/i }));

    expect(panel().getAttribute('data-mode')).toBe('docked');
    expect(width()).toBe(before);
  });

  it('follows a medium-sized title', () => {
    stubTextWidth(120);
    setup(['Software Architecture']);
    // 120 of text + 108 of chrome (the fallback, since jsdom does no layout) + 2
    // of slack against subpixel rounding.
    expect(width()).toBe('230px');
  });

  // Ceiling: a huge title must not take over the screen.
  it('respects the cap with a very long title', () => {
    stubTextWidth(900);
    setup(['A board with an absurdly long name to test the cap']);
    expect(width()).toBe('380px');
  });

  it('devolve o controle ao CSS ao desmontar', () => {
    const { unmount } = setup(['Architecture']);
    unmount();
    expect(width()).toBe('');
  });
});

describe('BoardSwitcher — presentation modes', () => {
  const dockButton = () => screen.getByRole('button', { name: /side/i });

  it('switches to docked and saves the preference', () => {
    setup();
    openPanel();
    fireEvent.click(dockButton());

    expect(panel().getAttribute('data-mode')).toBe('docked');
    expect(localStorage.getItem('omniboard-switcher-mode')).toBe('docked');
  });

  it('goes back to dropdown and collapses the panel', () => {
    setup();
    openPanel();
    fireEvent.click(dockButton()); // anchor
    fireEvent.click(dockButton()); // solta

    expect(panel().getAttribute('data-mode')).toBe('dropdown');
    expect(localStorage.getItem('omniboard-switcher-mode')).toBe('dropdown');
    expect(expanded()).toBe('false');
  });

  it('restores docked and already open on mount', () => {
    localStorage.setItem('omniboard-switcher-mode', 'docked');
    setup();
    expect(panel().getAttribute('data-mode')).toBe('docked');
    expect(expanded()).toBe('true');
  });

  // The point of docked mode: staying visible while navigating.
  it('docked, choosing a board does not close the panel', () => {
    localStorage.setItem('omniboard-switcher-mode', 'docked');
    const { manager } = setup();
    fireEvent.click(inPanel().getByText('Roadmap'));
    expect(manager.calls).toContain('switch:b1');
    expect(expanded()).toBe('true');
  });

  it('docked, clicking outside does not close the panel', () => {
    localStorage.setItem('omniboard-switcher-mode', 'docked');
    setup();
    fireEvent.mouseDown(document.body);
    expect(expanded()).toBe('true');
  });

  it('dropdown, choosing a board closes the panel', () => {
    setup();
    openPanel();
    fireEvent.click(inPanel().getByText('Roadmap'));
    expect(expanded()).toBe('false');
  });
});

describe('BoardSwitcher — backdrop regression', () => {
  // With a menu open, the backdrop covers the screen and used to receive the next
  // click; the outside-click handler then closed the WHOLE panel instead of the
  // menu.
  it('clicking the backdrop dismisses only the menu, not the panel', () => {
    setup();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /actions for Roadmap/i }));
    expect(screen.getByRole('menu')).toBeTruthy();

    const backdrop = document.querySelector('.switcher-menu-backdrop')!;
    fireEvent.mouseDown(backdrop);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(expanded()).toBe('true');
  });

  it('clicking inside the menu does not close the panel', () => {
    setup();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /actions for Roadmap/i }));
    const item = within(screen.getByRole('menu')).getByText('Duplicate');
    fireEvent.mouseDown(item);
    expect(expanded()).toBe('true');
  });
});

describe('BoardSwitcher — drag & drop', () => {
  /** Minimal dataTransfer: jsdom does not implement the drag object. */
  const dt = () => ({ effectAllowed: '', setData: vi.fn(), getData: vi.fn() });

  /**
   * testing-library's fireEvent drops `clientY` on drag events (jsdom does not
   * build DragEvent), and the handler depends on that coordinate to decide between
   * before/inside/after. So we dispatch a real MouseEvent with type 'dragover' —
   * React delivers it to onDragOver just fine.
   */
  const dragOverAt = (el: Element, clientY: number) => {
    const ev = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(ev, 'dataTransfer', { value: dt() });
    act(() => {
      el.dispatchEvent(ev);
    });
  };

  /** Pins the row geometry so the ratio computation is deterministic. */
  const stubRect = (el: Element) =>
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 0, height: 30, bottom: 30, left: 0, right: 100, width: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });

  const row = (name: string) => inPanel().getByText(name).closest('.board-row')!;

  it('drags a board into a folder', () => {
    const meta = new BoardMetaStore();
    const folder = meta.createFolder('Studies', null, 0);
    meta.patch('b1', { position: 1 });
    setup(['Architecture', 'Roadmap'], meta);
    openPanel();

    const origem = row('Roadmap');
    const target = row('Studies');

    fireEvent.dragStart(origem, { dataTransfer: dt() });
    stubRect(target);
    dragOverAt(target, 15); // middle of the row = "inside"
    fireEvent.drop(target, { dataTransfer: dt() });

    expect(meta.get('b1').folderId).toBe(folder.id);
  });

  it('reordena boards na raiz', () => {
    const meta = new BoardMetaStore({
      b0: { position: 0 },
      b1: { position: 1 },
      b2: { position: 2 },
    });
    setup(['Architecture', 'Roadmap', 'Draft'], meta);
    openPanel();

    const origem = row('Draft');
    const target = row('Architecture');

    fireEvent.dragStart(origem, { dataTransfer: dt() });
    stubRect(target);
    dragOverAt(target, 3); // top third = BEFORE the target
    fireEvent.drop(target, { dataTransfer: dt() });

    expect(meta.get('b2').position).toBe(0);
    expect(meta.get('b0').position).toBe(1);
  });

  it('refuses to move a folder into itself and says so', () => {
    const meta = new BoardMetaStore();
    meta.createFolder('Studies', null, 0);
    setup(['Architecture'], meta);
    openPanel();

    const line = row('Studies');
    fireEvent.dragStart(line, { dataTransfer: dt() });
    stubRect(line);
    dragOverAt(line, 15);
    fireEvent.drop(line, { dataTransfer: dt() });

    expect(screen.getByRole('status').textContent).toMatch(/inside itself/i);
    expect(meta.folders()[0].parentId).toBe(null);
  });

  // With a filter active the order is derived, so dragging is disabled to avoid
  // persisting an order the user cannot see.
  it('does not allow dragging while searching', () => {
    setup();
    openPanel();
    fireEvent.change(screen.getByLabelText('Search board'), { target: { value: 'road' } });
    expect(row('Roadmap').getAttribute('draggable')).toBe('false');
  });
});
