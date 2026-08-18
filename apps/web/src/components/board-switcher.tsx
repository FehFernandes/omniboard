import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoardFolder, BoardMetaMap, BoardMetaStore } from '../lib/boards/board-meta';
import {
  ancestors,
  children as treeChildren,
  dropModeFor,
  itemKey,
  move,
  nextPosition,
  type DragRef,
  type DropMode,
  type ItemKind,
  type TreeItem,
} from '../lib/boards/board-tree';

// Board manager. Instead of a fixed sidebar or a modal, it is a panel that
// expands from the island button itself (see .switcher-panel in the CSS).
//
// The tree and drag & drop logic is pure and lives in lib/boards/board-tree.ts;
// this file only holds rendering and interaction state.

export interface BoardDocSummary {
  id: string;
  name: string;
}

/**
 * A BoardManager event, in the minimal shape this panel consumes.
 *
 * `documents` is optional because the core emits two kinds on the same channel:
 * `documentsChange` (carries the list) and `activeChange` (only the activeId).
 * Modeling it this way keeps the real BoardManager assignable to this interface.
 */
export interface BoardManagerEventLike {
  type: string;
  documents?: BoardDocSummary[];
  activeId: string;
}

/** The subset of BoardManager the panel uses (makes testing without the core easy). */
export interface BoardManagerLike {
  list(): BoardDocSummary[];
  getActiveId(): string;
  create(name?: string): string;
  switch(id: string): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  duplicate(id: string): string | null;
  on(
    type: 'documentsChange' | 'activeChange',
    listener: (e: BoardManagerEventLike) => void,
  ): () => void;
}

type Filter = 'all' | 'starred' | 'recent';

/**
 * How the manager presents itself:
 * - `dropdown`: expands inside the pill and closes when a board is picked.
 * - `docked`: a panel pinned to the left, vertically centered, that stays open
 *   while you navigate between boards.
 */
type Mode = 'dropdown' | 'docked';

const MODE_KEY = 'omniboard-switcher-mode';

/** Reads the saved preference. localStorage can throw (private mode/quota). */
function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'docked' ? 'docked' : 'dropdown';
  } catch {
    return 'dropdown';
  }
}

function writeMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* the preference does not persist, but the current session works */
  }
}

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PILL_MENU_EVENT = 'omniboard:pill-menu-open';
const DRAG_MIME = 'application/x-omniboard-tree';
/** Indentation per tree level, in px. */
const INDENT = 14;

// ── Adaptive width ──
// The manager follows the size of the active board's title, in both modes.
//
// The width is NOT estimated: we measure the text in an unconstrained mirror
// element, and the "chrome" (everything in the row that is not the text:
// hamburger, separator, icon, chevron and paddings) by subtracting the name width
// from the row width. A constant for the chrome once caused titles to be cut off —
// any padding change in the CSS invalidated it.
/** Used only when layout is unavailable (jsdom, first paint). */
const CHROME_FALLBACK = 108;
/**
 * Floor. Deliberately kept low: every pixel above the row's natural width becomes
 * dead space to the right of the chevron. The value covers the minimum of the
 * action bar (four 22px buttons plus a truncatable label) and nothing more.
 */
const MIN_WIDTH = 152;
/** Ceiling: long titles must not take over the screen. */
const MAX_WIDTH = 380;

/** Ignora acento e caixa na busca ("Diagrama" casa com "diagrama"). */
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const Icon = ({ d, filled }: { d: string; filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={d} />
  </svg>
);

const PATH = {
  layers: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
  chevron: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm10 18-4.35-4.35',
  star: 'M12 2.5l2.9 5.9 6.6.9-4.8 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.5 9.3l6.6-.9L12 2.5Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l4 2',
  files: 'M4 4h9l3 3v13H4V4Zm12 3h4v13h-4',
  // Funil de filtro.
  funnel: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3Z',
  // Folders in the lucide stroke style: short top tab and rounded corners.
  folder:
    'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  folderOpen:
    'M6 14l1.45-2.9A2 2 0 0 1 9.24 10H22a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2',
  folderPlus:
    'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2ZM12 10v6M9 13h6',
  board: 'M4 4h16v16H4V4Zm0 6h16M10 10v10',
  // Visual pair of folderPlus: same frame stroke plus a "+" in the center.
  boardPlus:
    'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM12 8v8M8 12h8',
  // Panel with a divider on the left: the "pin to the side" metaphor.
  panelLeft: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9 3v18',
  plus: 'M12 5v14M5 12h14',
  pencil: 'M4 20h4L20 8l-4-4L4 16v4Z',
  copy: 'M9 9h11v11H9V9ZM4 15V4h11',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M4 12l5 5L20 6',
};

interface Props {
  manager: BoardManagerLike;
  metaStore: BoardMetaStore;
  /** Where the trigger (board name + chevron) is rendered, in the pill row. */
  triggerSlot: HTMLElement;
  /** The area inside the pill that expands to reveal the manager. */
  panelSlot: HTMLElement;
  /**
   * The whole pill. It receives `data-expanded` to grow and serves as the
   * reference for outside clicks — the panel is no longer a separate card, so
   * there is no component-owned wrapper to measure against.
   */
  container: HTMLElement;
}

interface RowMenu {
  kind: ItemKind;
  id: string;
  top: number;
  left: number;
}

interface DropHint {
  key: string;
  mode: DropMode;
}

interface Editing {
  kind: ItemKind;
  id: string;
  value: string;
}

export function BoardSwitcher({ manager, metaStore, triggerSlot, panelSlot, container }: Props) {
  const [mode, setMode] = useState<Mode>(readMode);
  // When docked, the panel starts visible: that is the user's stated preference.
  const [open, setOpen] = useState(() => readMode() === 'docked');
  const [documents, setDocuments] = useState(() => manager.list());
  const [activeId, setActiveId] = useState(() => manager.getActiveId());
  const [meta, setMeta] = useState<BoardMetaMap>(() => metaStore.all());
  const [folders, setFolders] = useState<BoardFolder[]>(() => metaStore.folders());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ top: number; left: number } | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragged, setDragged] = useState<DragRef | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [warning, setWarning] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);
  /** Panel content — measured to animate the exact expansion height. */
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  /** Active board name — measured so the width follows the title. */
  const nameRef = useRef<HTMLSpanElement>(null);
  /** Espelho do name, fora do fluxo e sem recorte: mede o text inteiro. */
  const sizerRef = useRef<HTMLSpanElement>(null);

  // Declared here (and not next to the render) because the width measuring effect
  // depends on it: using it before the declaration would hit the TDZ.
  const activeName = documents.find((doc) => doc.id === activeId)?.name ?? 'Board';

  // ── Keeping in sync with the BoardManager and the store ──
  useEffect(() => {
    // The core emits `documentsChange` (the list changed) and `activeChange` (only
    // the active board changed). We need both: create/remove fires the first,
    // switch() fires the second.
    const apply = (e: BoardManagerEventLike) => {
      setDocuments(e.documents ?? manager.list());
      setActiveId(e.activeId);
    };
    const offDocs = manager.on('documentsChange', apply);
    const offActive = manager.on('activeChange', apply);
    const offMeta = metaStore.subscribe((state) => {
      setMeta({ ...state.meta });
      setFolders([...state.folders]);
    });
    return () => {
      offDocs();
      offActive();
      offMeta();
    };
  }, [manager, metaStore]);

  // Another island opened its menu: close this panel.
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== 'switcher') setOpen(false);
    };
    window.addEventListener(PILL_MENU_EVENT, onOther);
    return () => window.removeEventListener(PILL_MENU_EVENT, onOther);
  }, []);

  // The pill only grows in dropdown mode; when docked, the panel lives outside it
  // (but the pill keeps the same width so both pieces stay aligned).
  useEffect(() => {
    container.toggleAttribute('data-expanded', open && mode === 'dropdown');
    return () => container.removeAttribute('data-expanded');
  }, [container, open, mode]);

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next: Mode = current === 'docked' ? 'dropdown' : 'docked';
      writeMode(next);
      // Switching to docked leaves the panel visible; going back to dropdown
      // collapses it, otherwise we would leave a giant pill open for no reason.
      setOpen(next === 'docked');
      return next;
    });
    setRowMenu(null);
    setFilterMenu(null);
  }, []);

  // Measures the content to animate the exact height instead of a guessed
  // max-height (which would make the animation "end" early for short content).
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setContentHeight(el.scrollHeight);
    measure();
    // Content height changes with search, folders opening and new items.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // The manager width follows the active board's title. It is published as a
  // variable on the body because the two consumers live in different trees: the
  // pill (dropdown mode) and the docked panel, portaled to the body.
  useEffect(() => {
    const name = nameRef.current;
    const sizer = sizerRef.current;
    const row = container.querySelector<HTMLElement>('.pill-row');
    if (!name || !sizer) return;

    const apply = () => {
      // The mirror has no width constraint, so it gives the real fractional text
      // measurement — unlike the name's scrollWidth, which is an integer and is
      // already affected by ellipsis clipping.
      const text = sizer.getBoundingClientRect().width || name.scrollWidth;
      // Measured chrome: the row minus the name. It is PURE chrome only because
      // the name has `flex: 1` and absorbs all the slack in the row — that is why
      // the result does not depend on the current width and converges in one pass.
      const measured = row
        ? row.getBoundingClientRect().width - name.getBoundingClientRect().width
        : 0;
      const chrome = measured > 0 ? measured : CHROME_FALLBACK;
      // +2 of slack: flex space distribution and subpixel rounding can come up a
      // fraction short, and any deficit triggers the "...".
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(text + chrome) + 2));
      document.body.style.setProperty('--switcher-w', `${width}px`);
    };
    apply();
    // Fonts may load after the first layout and change the measurement.
    document.fonts?.ready?.then(apply).catch(() => {});
  }, [activeName, container]);

  // Devolve o controle da width ao CSS at o componente sai.
  useEffect(
    () => () => {
      document.body.style.removeProperty('--switcher-w');
    },
    [],
  );

  // Closes on outside click or Escape. While inline editing is active, Escape
  // belongs to the input (it cancels the rename) — hence the early returns.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const el = target as Element;

      // With a menu open there is a backdrop covering the screen: the click lands
      // on IT, not on the intended button. Treating that as "outside" used to
      // close the whole panel instead of just dismissing the menu.
      if (el?.closest?.('.switcher-menu-backdrop')) {
        setRowMenu(null);
        setFilterMenu(null);
        return;
      }
      // Os menus vivem em portais no body, fora da pill.
      if (el?.closest?.('.switcher-menu')) return;

      // Docked to the left, the panel is a fixed piece: it does not close itself.
      if (mode === 'docked') return;

      if (!container.contains(target)) {
        setOpen(false);
        setRowMenu(null);
        setFilterMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (filterMenu) {
        setFilterMenu(null);
        return;
      }
      if (rowMenu) {
        setRowMenu(null);
        return;
      }
      if (editing || newFolderParent !== undefined) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, editing, newFolderParent, rowMenu, filterMenu, container]);

  // Focus search on open: the common case is searching, not mousing around.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else {
      setQuery('');
      setEditing(null);
      setRowMenu(null);
      setFilterMenu(null);
      setNewFolderParent(undefined);
      setDragged(null);
      setDropHint(null);
      setWarning('');
    }
  }, [open]);

  // The invalid-move warning is transient.
  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(''), 2600);
    return () => clearTimeout(timer);
  }, [warning]);

  const toggleOpen = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) window.dispatchEvent(new CustomEvent(PILL_MENU_EVENT, { detail: 'switcher' }));
      return next;
    });
  }, []);

  // ── Filtragem ──
  const needle = normalize(query.trim());
  const searching = needle.length > 0 || filter !== 'all';

  const visibleBoards = useMemo(() => {
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    return documents.filter((doc) => {
      const info = meta[doc.id] ?? {};
      if (filter === 'starred' && !info.starred) return false;
      if (filter === 'recent' && !(info.updatedAt && info.updatedAt >= cutoff)) return false;
      if (!needle) return true;
      return normalize(doc.name).includes(needle);
    });
  }, [documents, filter, meta, needle]);

  /**
   * Folders that must appear while searching/filtering: those matching by name and
   * those containing (at any depth) a visible board. Without this, a result inside
   * a folder would be invisible.
   */
  const visibleFolderIds = useMemo(() => {
    if (!searching) return new Set(folders.map((f) => f.id));
    const visible = new Set<string>();
    const keep = (folderId: string | null | undefined) => {
      if (!folderId) return;
      visible.add(folderId);
      for (const id of ancestors(folders, folderId)) visible.add(id);
    };
    for (const doc of visibleBoards) keep(meta[doc.id]?.folderId);
    for (const folder of folders) {
      if (needle && normalize(folder.name).includes(needle)) keep(folder.id);
    }
    return visible;
  }, [folders, meta, needle, searching, visibleBoards]);

  /** Reordering only makes sense on the full tree: with a filter, order is derived. */
  const canReorder = !searching;

  const childrenOf = useCallback(
    (parentId: string | null): TreeItem[] =>
      treeChildren(folders, visibleBoards, meta, parentId).filter(
        (item) => item.kind === 'board' || visibleFolderIds.has(item.id),
      ),
    [folders, meta, visibleBoards, visibleFolderIds],
  );

  const isExpanded = (folder: BoardFolder) => (folder.expanded ?? true) || searching;

  // ── Actions ──
  /** When docked the panel is permanent; in dropdown mode, picking closes it. */
  const closeIfDropdown = () => {
    if (mode === 'dropdown') setOpen(false);
  };

  const select = (id: string) => {
    manager.switch(id);
    closeIfDropdown();
  };

  const createBoard = (folderId: string | null) => {
    const id = manager.create();
    metaStore.patch(id, {
      folderId,
      position: nextPosition(folders, manager.list(), metaStore.all(), folderId),
      updatedAt: Date.now(),
    });
    closeIfDropdown();
  };

  const beginRename = (kind: ItemKind, id: string) => {
    const name =
      kind === 'board'
        ? documents.find((d) => d.id === id)?.name
        : folders.find((f) => f.id === id)?.name;
    if (name === undefined) return;
    setRowMenu(null);
    setEditing({ kind, id, value: name });
  };

  const commitRename = () => {
    if (!editing) return;
    const name = editing.value.trim();
    if (name) {
      if (editing.kind === 'board') manager.rename(editing.id, name);
      else metaStore.renameFolder(editing.id, name);
    }
    setEditing(null);
  };

  const removeBoard = (id: string) => {
    const doc = documents.find((item) => item.id === id);
    setRowMenu(null);
    if (!doc) return;
    // The core prevents removing the last board (it is cleared instead of
    // deleted), but we confirm anyway because the action erases content.
    if (!window.confirm(`Delete the board "${doc.name}"?`)) return;
    manager.remove(id);
  };

  const removeFolder = (id: string) => {
    const folder = folders.find((f) => f.id === id);
    setRowMenu(null);
    if (!folder) return;
    // No destructive confirmation: nothing is erased, content moves up one level.
    metaStore.deleteFolder(id);
  };

  const beginNewFolder = (parentId: string | null) => {
    setRowMenu(null);
    setNewFolderName('');
    setNewFolderParent(parentId);
    if (parentId) {
      const folder = folders.find((f) => f.id === parentId);
      if (folder && !(folder.expanded ?? true)) metaStore.toggleFolder(parentId);
    }
  };

  const commitNewFolder = () => {
    const name = newFolderName.trim();
    const parentId = newFolderParent ?? null;
    if (name) {
      metaStore.createFolder(name, parentId, nextPosition(folders, documents, meta, parentId));
    }
    setNewFolderParent(undefined);
    setNewFolderName('');
  };

  /** Filter menu position (portaled to the body: the panel has overflow hidden). */
  const openFilterMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (filterMenu) {
      setFilterMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 168;
    setFilterMenu({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
  };

  const openRowMenu = (e: React.MouseEvent<HTMLButtonElement>, kind: ItemKind, id: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 196;
    const height = kind === 'folder' ? 172 : 176;
    setRowMenu({
      kind,
      id,
      top: Math.max(8, window.innerHeight - rect.bottom > height ? rect.bottom + 4 : rect.top - height - 4),
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
  };

  // ── Drag & drop ──
  const onDragStart = (e: React.DragEvent, item: TreeItem) => {
    const ref: DragRef = { kind: item.kind, id: item.id };
    e.dataTransfer.effectAllowed = 'move';
    // Payload under our own MIME type: keeps the board from interpreting the drop
    // as a file/image import.
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ref));
    setDragged(ref);
    setRowMenu(null);
  };

  const onRowDragOver = (e: React.DragEvent, item: TreeItem) => {
    if (!dragged || !canReorder) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    setDropHint({ key: itemKey(item), mode: dropModeFor(item, ratio) });
  };

  const applyMove = (parentId: string | null, index: number) => {
    if (!dragged) return;
    const result = move(folders, documents, meta, dragged, parentId, index);
    if (result.rejected) {
      setWarning(result.rejected);
    } else {
      if (Object.keys(result.boards).length) metaStore.patchMany(result.boards);
      if (Object.keys(result.folders).length) metaStore.patchFolders(result.folders);
    }
    setDragged(null);
    setDropHint(null);
  };

  const onRowDrop = (e: React.DragEvent, item: TreeItem, parentId: string | null, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragged || !dropHint) return;
    if (dropHint.mode === 'inside' && item.kind === 'folder') {
      applyMove(item.id, nextPosition(folders, documents, meta, item.id));
      return;
    }
    applyMove(parentId, index + (dropHint.mode === 'after' ? 1 : 0));
  };

  const endDropZone = (parentId: string | null, count: number) => {
    const key = `end:${parentId ?? 'root'}`;
    return (
      <div
        className="tree-end-zone"
        onDragOver={(e) => {
          if (!dragged) return;
          e.preventDefault();
          e.stopPropagation();
          setDropHint({ key, mode: 'after' });
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          applyMove(parentId, count);
        }}
      >
        {dropHint?.key === key && <div className="tree-drop-line" />}
      </div>
    );
  };

  // ── Tree rendering ──
  const renderLevel = (parentId: string | null, level: number): React.ReactNode => {
    const items = childrenOf(parentId);
    return (
      <div className="tree-level">
        {items.map((item, index) => {
          const key = itemKey(item);
          const hint = dropHint?.key === key ? dropHint.mode : null;
          const isEditing = editing?.kind === item.kind && editing.id === item.id;
          const folder = item.kind === 'folder' ? item.folder : null;
          const expanded = folder ? isExpanded(folder) : false;
          const isActive = item.kind === 'board' && item.id === activeId;
          const starred = item.kind === 'board' && Boolean(meta[item.id]?.starred);

          return (
            <div key={key}>
              {hint === 'before' && <div className="tree-drop-line" />}
              <div
                className="board-row"
                data-active={isActive || undefined}
                data-kind={item.kind}
                data-drop-inside={hint === 'inside' || undefined}
                data-dragging={dragged?.kind === item.kind && dragged.id === item.id ? true : undefined}
                style={{ paddingLeft: 8 + level * INDENT }}
                draggable={canReorder && !isEditing}
                onDragStart={(e) => onDragStart(e, item)}
                onDragEnd={() => {
                  setDragged(null);
                  setDropHint(null);
                }}
                onDragOver={(e) => onRowDragOver(e, item)}
                onDrop={(e) => onRowDrop(e, item, parentId, index)}
                onClick={() => {
                  if (isEditing) return;
                  if (folder) metaStore.toggleFolder(folder.id);
                  else select(item.id);
                }}
              >
                <span className="brow-twisty" aria-hidden="true">
                  {folder && <Icon d={expanded ? PATH.chevron : PATH.chevronRight} />}
                </span>
                <span className="brow-glyph" aria-hidden="true">
                  <Icon d={folder ? (expanded ? PATH.folderOpen : PATH.folder) : PATH.board} />
                </span>

                {isEditing ? (
                  <input
                    autoFocus
                    className="brow-input"
                    value={editing.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    aria-label={`Rename ${item.name}`}
                  />
                ) : (
                  <>
                    <span
                      className="brow-name"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        beginRename(item.kind, item.id);
                      }}
                    >
                      {item.name}
                    </span>
                    {starred && (
                      <span className="brow-star" title="Starred">
                        <Icon d={PATH.star} filled />
                      </span>
                    )}
                    <button
                      type="button"
                      className="brow-act"
                      onClick={(e) => openRowMenu(e, item.kind, item.id)}
                      title="More actions"
                      aria-label={`Actions for ${item.name}`}
                    >
                      <Icon d={PATH.more} />
                    </button>
                  </>
                )}
              </div>
              {hint === 'after' && <div className="tree-drop-line" />}

              {folder && expanded && (
                <div className="tree-branch" style={{ ['--guide' as string]: `${8 + level * INDENT + 11}px` }}>
                  <span className="tree-guide" aria-hidden="true" />
                  {renderLevel(folder.id, level + 1)}
                </div>
              )}
            </div>
          );
        })}

        {newFolderParent === parentId && (
          <form
            className="tree-new-folder"
            style={{ paddingLeft: 8 + level * INDENT }}
            onSubmit={(e) => {
              e.preventDefault();
              commitNewFolder();
            }}
          >
            <span className="brow-glyph" aria-hidden="true">
              <Icon d={PATH.folder} />
            </span>
            <input
              autoFocus
              className="brow-input"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setNewFolderParent(undefined);
              }}
              placeholder="Folder name"
              aria-label="New folder name"
            />
            <button type="submit" className="brow-act" title="Create folder" aria-label="Create folder">
              <Icon d={PATH.check} />
            </button>
            <button
              type="button"
              className="brow-act"
              onClick={() => setNewFolderParent(undefined)}
              title="Cancel"
              aria-label="Cancel new folder"
            >
              <Icon d={PATH.close} />
            </button>
          </form>
        )}

        {canReorder && dragged && endDropZone(parentId, items.length)}
      </div>
    );
  };

  const menuBoard = rowMenu?.kind === 'board' ? documents.find((d) => d.id === rowMenu.id) : undefined;
  const menuFolder = rowMenu?.kind === 'folder' ? folders.find((f) => f.id === rowMenu.id) : undefined;

  const filters: { key: Filter; label: string; path: string }[] = [
    { key: 'all', label: 'All', path: PATH.files },
    { key: 'starred', label: 'Starred', path: PATH.star },
    { key: 'recent', label: 'Recent', path: PATH.clock },
  ];

  const rootItems = childrenOf(null);
  const isEmpty = rootItems.length === 0 && newFolderParent === undefined;

  return (
    <>
      {createPortal(
        <button
          type="button"
          className="board-current"
          onClick={toggleOpen}
          title="Manage boards"
          /* The visible content is just the board name; the aria-label adds the
             button's purpose, which otherwise would never be announced. */
          aria-label={`Manage boards — current: ${activeName}`}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="glyph">
            <Icon d={PATH.layers} />
          </span>
          <span className="cur-name" ref={nameRef}>
            {activeName}
          </span>
          {/* Measuring mirror: out of flow, invisible and unclipped. It exists
              because the name itself is cut by ellipsis, so measuring it would
              give the already-limited width instead of the title's real width. */}
          <span className="cur-name-sizer" ref={sizerRef} aria-hidden="true">
            {activeName}
          </span>
          <span className="chev" data-open={open || undefined}>
            <Icon d={PATH.chevron} />
          </span>
        </button>,
        triggerSlot,
      )}

      {/* In dropdown mode the panel lives inside the pill (which grows). When
          docked it has to escape the pill to sit fixed on the side — hence the
          portal target changing with the mode. */}
      {createPortal(
        <div
          className="switcher-panel"
          data-open={open || undefined}
          data-mode={mode}
          style={{ ['--panel-h' as string]: `${contentHeight}px` }}
          role="dialog"
          aria-label="Boards"
        >
          <div className="switcher-panel-inner" ref={contentRef}>
            <div className="switcher-search">
              <span className="ico">
                <Icon d={PATH.search} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search board"
                aria-label="Search board"
              />
              {query && (
                <button type="button" className="brow-act" onClick={() => setQuery('')} title="Clear search">
                  <Icon d={PATH.close} />
                </button>
              )}
            </div>

            <div className="switcher-toolbar">
              <span className="switcher-toolbar-title">Boards</span>
              {/* Presentation toggle. The choice lives in the browser
                  (localStorage), so everyone works the way they prefer. */}
              <button
                type="button"
                className="brow-act is-visible"
                data-on={mode === 'docked' || undefined}
                onClick={toggleMode}
                title={mode === 'docked' ? 'Undock from the side' : 'Dock to the side'}
                aria-label={mode === 'docked' ? 'Undock from the side' : 'Dock to the side'}
                aria-pressed={mode === 'docked'}
              >
                <Icon d={PATH.panelLeft} />
              </button>
              {/* The manager's three actions sit together in this bar. Before,
                  "new board" was a strip in the footer while "new folder" was an
                  icon here — two create actions, two different treatments. */}
              <button
                type="button"
                className="brow-act is-visible"
                data-on={filter !== 'all' || undefined}
                onClick={(e) => openFilterMenu(e)}
                title="Filter boards"
                aria-label="Filter boards"
                aria-haspopup="listbox"
                aria-expanded={filterMenu !== null}
              >
                <Icon d={PATH.funnel} filled={filter !== 'all'} />
              </button>
              <button
                type="button"
                className="brow-act is-visible"
                onClick={() => createBoard(null)}
                title="New board"
                aria-label="New board"
              >
                <Icon d={PATH.boardPlus} />
              </button>
              <button
                type="button"
                className="brow-act is-visible"
                onClick={() => beginNewFolder(null)}
                title="New folder"
                aria-label="New folder"
              >
                <Icon d={PATH.folderPlus} />
              </button>
            </div>

            {warning && (
              <p className="switcher-warning" role="status">
                {warning}
              </p>
            )}

            <div className="switcher-list">
              {isEmpty ? (
                <p className="switcher-empty">
                  {searching ? 'No board found' : 'No boards yet'}
                </p>
              ) : (
                renderLevel(null, 0)
              )}
            </div>
          </div>
        </div>,
        mode === 'docked' ? document.body : panelSlot,
      )}

      {/* Filter menu: portalled into the body because the panel has overflow
          hidden (the height animation depends on it) and would clip an inner
          popover. */}
      {filterMenu &&
        createPortal(
          <>
            <div className="switcher-menu-backdrop" onClick={() => setFilterMenu(null)} />
            <div
              className="switcher-menu is-filter"
              style={{ top: filterMenu.top, left: filterMenu.left }}
              role="listbox"
              aria-label="Filter boards"
            >
              {filters.map(({ key, label, path }) => (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={filter === key}
                  data-on={filter === key || undefined}
                  onClick={() => {
                    setFilter(key);
                    setFilterMenu(null);
                  }}
                >
                  <Icon d={path} filled={key === 'starred' && filter === 'starred'} />
                  <span className="label">{label}</span>
                  {filter === key && (
                    <span className="tick">
                      <Icon d={PATH.check} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}

      {/* Row action menu: portaled to the body so it is not clipped by the
          panel's overflow and does not inherit its stacking context. */}
      {rowMenu &&
        (menuBoard || menuFolder) &&
        createPortal(
          <>
            <div className="switcher-menu-backdrop" onClick={() => setRowMenu(null)} />
            <div className="switcher-menu" style={{ top: rowMenu.top, left: rowMenu.left }} role="menu">
              {menuFolder && (
                <>
                  <button type="button" role="menuitem" onClick={() => createBoard(menuFolder.id)}>
                    <Icon d={PATH.plus} />
                    New board here
                  </button>
                  <button type="button" role="menuitem" onClick={() => beginNewFolder(menuFolder.id)}>
                    <Icon d={PATH.folderPlus} />
                    New subfolder
                  </button>
                  <button type="button" role="menuitem" onClick={() => beginRename('folder', menuFolder.id)}>
                    <Icon d={PATH.pencil} />
                    Rename
                  </button>
                  <hr />
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => removeFolder(menuFolder.id)}
                  >
                    <Icon d={PATH.trash} />
                    Delete folder
                  </button>
                </>
              )}

              {menuBoard && (
                <>
                  <button type="button" role="menuitem" onClick={() => beginRename('board', menuBoard.id)}>
                    <Icon d={PATH.pencil} />
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setRowMenu(null);
                      manager.duplicate(menuBoard.id);
                    }}
                  >
                    <Icon d={PATH.copy} />
                    Duplicate
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setRowMenu(null);
                      metaStore.toggleStarred(menuBoard.id);
                    }}
                  >
                    <Icon d={PATH.star} filled={Boolean(meta[menuBoard.id]?.starred)} />
                    {meta[menuBoard.id]?.starred ? 'Unstar' : 'Star'}
                  </button>
                  <hr />
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => removeBoard(menuBoard.id)}
                  >
                    <Icon d={PATH.trash} />
                    Delete
                  </button>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
