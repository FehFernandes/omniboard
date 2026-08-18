import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Board,
  BoardManager,
  ICONS,
  STICKY_COLORS,
  getElementsBounds,
} from '@omniboard/react';
import { useAuth } from '../lib/auth/auth-context';
import { GOOGLE_LOGIN_URL } from '../lib/auth/google';
import { BoardMetaStore } from '../lib/boards/board-meta';
import {
  VersionConflict,
  syncWorkspace,
  type EnvelopeStorage,
  type SaveState,
} from '../lib/boards/workspace-sync';
import { reportError } from '../lib/telemetry/errors';
import { createImageUploader, UploadError } from '../lib/uploads/images';
import { migrateEmbeddedImages } from '../lib/uploads/migrate-embedded';
import {
  templateSize,
  templatesByGroup,
  type Template,
} from '../lib/boards/templates';
import { CommentStore } from '../lib/boards/comments';
import { BoardComments } from '../components/board-comments';
import { BoardNoteModal } from '../components/board-note-modal';
import { BoardLinkPicker } from '../components/board-link-picker';
import { BoardShareModal } from '../components/board-share-modal';
import { BoardSwitcher } from '../components/board-switcher';
import type { ApiClient } from '../lib/api/client';
import './board-app.css';

// Markup for the UI islands/panels (ported from examples/index.html). It is
// injected via innerHTML and then "hydrated" imperatively in initBoardApp.
const APP_HTML = `
  <div id="board"></div>

  <aside class="props" id="props">
    <section id="strokeSection">
      <div class="sec">Stroke</div>
      <details class="props-dd" id="strokeDD">
        <summary class="chip" id="strokeChip" title="Stroke color" aria-label="Stroke color"></summary>
        <div class="dd-pop"><div class="swatches" id="strokeSwatches"></div></div>
      </details>
    </section>
    <section id="bgSection">
      <div class="sec">Background</div>
      <details class="props-dd" id="bgDD">
        <summary class="chip" id="bgChip" title="Fill" aria-label="Fill color"></summary>
        <div class="dd-pop"><div class="swatches" id="bgSwatches"></div></div>
      </details>
    </section>
    <section id="stickyColorSection" style="display:none;">
      <div class="sec">Sticky color</div>
      <details class="props-dd" id="stickyColorDD">
        <summary class="chip" id="stickyChip" title="Sticky color" aria-label="Sticky color"></summary>
        <div class="dd-pop"><div class="swatches" id="stickySwatches"></div></div>
      </details>
    </section>
    <section id="widthSection">
      <div class="sec">Stroke width</div>
      <details class="props-dd" id="widthDD">
        <summary class="chip" id="widthChip" title="Stroke width" aria-label="Stroke width"></summary>
        <div class="dd-pop">
          <div class="seg" id="widthSeg">
            <button data-w="1" title="Thin"><span class="dash" style="width:16px;height:2px"></span></button>
            <button data-w="2" title="Medium"><span class="dash" style="width:16px;height:3px"></span></button>
            <button data-w="4" title="Thick"><span class="dash" style="width:16px;height:5px"></span></button>
          </div>
        </div>
      </details>
    </section>
    <section id="textSection" style="display:none;">
      <div class="sec">Text</div>
      <details class="props-dd" id="textDD">
        <summary class="chip chip-aa" id="textChip" title="Text" aria-label="Text options">Aa</summary>
        <div class="dd-pop dd-col">
          <div class="text-row">
            <label>Font<select id="fontFamily"></select></label>
            <label>Size<input type="number" id="fontSize" min="8" max="120" step="1" /></label>
          </div>
          <div class="seg" id="fontStyleSeg">
            <button id="fontBold" title="Bold">B</button>
            <button id="fontItalic" title="Italic"><i>I</i></button>
          </div>
          <div class="seg" id="textAlignSeg">
            <button data-align="left" title="Align left"></button>
            <button data-align="center" title="Align center"></button>
            <button data-align="right" title="Align right"></button>
          </div>
          <div class="seg" id="verticalAlignSeg">
            <button data-valign="top" title="Align top"></button>
            <button data-valign="middle" title="Align middle"></button>
          </div>
        </div>
      </details>
    </section>
    <section id="opacitySection">
      <div class="sec">Opacity</div>
      <details class="props-dd" id="opacityDD">
        <summary class="chip" id="opacityChip" title="Opacity" aria-label="Opacity"></summary>
        <div class="dd-pop">
          <input type="range" id="opacity" min="0" max="100" step="5" value="100" aria-label="Opacity" />
          <span class="dd-val" id="opacityVal">100%</span>
        </div>
      </details>
    </section>
    <section id="layersSection">
      <div class="sec">Layers</div>
      <div class="seg">
        <button id="pBack" title="Send to back"></button>
        <button id="pFront" title="Bring to front"></button>
      </div>
    </section>
    <section id="actionsSection">
      <div class="sec">Actions</div>
      <div class="seg">
        <button id="pDup" title="Duplicate"></button>
        <button id="pDel" class="danger" title="Delete"></button>
      </div>
    </section>
  </aside>

  <div class="pill pill-left" id="pillLeft">
    <!-- Compact row: this is what you see with the manager closed. -->
    <div class="pill-row">
    <details class="dd" id="hamb">
      <summary class="iconbtn" id="hambBtn" title="Menu"></summary>
      <div class="panel">
        <div class="sec">Appearance</div>
        <label class="row">Selection color<input type="color" id="selColor" value="#6965db" /></label>
        <label>Grid spacing<input type="range" id="gridSpace" min="10" max="80" value="20" /></label>
        <label>Handle size<input type="range" id="handleSz" min="4" max="18" value="8" /></label>
        <label>Background pattern
          <select id="gridPattern">
            <option value="dots">Dots</option>
            <option value="crosses">Crosses</option>
            <option value="lines">Lines</option>
            <option value="grid">Grid</option>
            <option value="none">None</option>
          </select>
        </label>

        <div class="sec">Lab</div>
        <label class="row">Search
          <input type="search" id="searchBox" placeholder="text..." style="flex:1; min-width:0; height:30px; border:1px solid var(--ui-border); border-radius:8px; background:var(--ui-solid); color:var(--ui-fg); padding:0 8px; outline:none;" />
        </label>
        <button class="item" data-act="focus"><span class="ico"></span>Focus mode (dim)</button>
        <button class="item" data-act="celebrate"><span class="ico"></span>Celebrate</button>
        <div class="sec">Auto-arrange</div>
        <div class="seg">
          <button data-layout="grid" title="Grid"></button>
          <button data-layout="horizontal" title="Horizontal"></button>
          <button data-layout="vertical" title="Vertical"></button>
          <button data-layout="circle" title="Circle"></button>
        </div>

        <div class="sec">Actions</div>
        <button class="item" data-act="share"><span class="ico"></span>Share by link</button>
        <button class="item" data-act="fit"><span class="ico"></span>Fit to screen</button>
        <button class="item" data-act="png"><span class="ico"></span>Export PNG</button>
        <button class="item" data-act="export"><span class="ico"></span>Export workspace (JSON)</button>
        <button class="item" data-act="import"><span class="ico"></span>Import workspace (JSON)</button>

        <hr />
        <button class="item danger" data-act="clear"><span class="ico"></span>Clear this board</button>
      </div>
    </details>
    <span class="sep"></span>
    <!-- Trigger for the boards manager (React portal). -->
    <span id="boardSwitcherSlot" class="switcher-slot"></span>
    </div>
    <!-- The area the pill itself expands to reveal the manager. It lives INSIDE
         the pill (rather than as a floating card) so the bar grows as a single
         element, with no separate border or shadow. -->
    <div id="boardPanelSlot"></div>
  </div>

  <div class="pill pill-tools" id="toolbar">
    <button class="iconbtn" id="lock" title="Navigation mode (interact without editing)"></button>
    <span class="sep"></span>
    <button class="tool" data-tool="selection" title="Select (V)"></button>
    <button class="tool" data-tool="hand" title="Pan (H)"></button>
    <span class="sep"></span>
    <button class="tool" data-tool="rectangle" title="Rectangle (R)"></button>
    <button class="tool" data-tool="ellipse" title="Ellipse (O)"></button>
    <button class="tool" data-tool="line" title="Line (L)"></button>
    <button class="tool" data-tool="arrow" title="Arrow (A)"></button>
    <details class="shapes-dd" id="shapesDD">
      <summary id="shapesBtn" title="Shapes (diagrams / system design)"></summary>
  <div class="shapes-panel" id="shapesPanel" style="grid-template-columns: repeat(4, 44px);"></div>
    </details>
    <button class="tool" data-tool="freedraw" title="Freehand (P)"></button>
    <button class="tool" data-tool="text" title="Text (T)"></button>
    <span class="sep"></span>
    <button class="tool" data-tool="image" title="Image"></button>
    <button class="tool" data-tool="embed" title="Embed (iframe / video)"></button>
    <button class="tool" data-tool="tasks" title="Tasks (card)"></button>
    <details class="shapes-dd" id="stickyDD">
      <summary id="stickyBtn" title="Post-it / Sticky note"></summary>
      <!-- 7 columns: two rows (pastels on top, saturated tones below). -->
      <div class="shapes-panel" id="stickyPanel" style="grid-template-columns: repeat(7, 30px);"></div>
    </details>
    <button class="tool" data-tool="frame" title="Frame (whiteboard)"></button>
    <button class="tool" data-tool="note" title="Note (long text in a modal)"></button>
    <button class="tool" data-tool="link" title="Shortcut to another board"></button>
    <span class="sep"></span>
    <details class="shapes-dd" id="templatesDD">
      <summary id="templatesBtn" title="Ready-made templates"></summary>
      <div class="templates-panel" id="templatesPanel"></div>
    </details>
  </div>

  <div class="pill pill-right">
    <button class="iconbtn" id="undo" title="Undo (Ctrl+Z)"></button>
    <button class="iconbtn" id="redo" title="Redo (Ctrl+Shift+Z)"></button>
    <span class="sep"></span>
    <button class="iconbtn" id="zoomOut" title="Zoom out"></button>
    <button class="iconbtn" id="zoomIn" title="Zoom in"></button>
    <span class="sep"></span>
    <button class="iconbtn" id="fullscreen" title="Fullscreen"></button>
    <button class="iconbtn" id="comment" title="Comment (C)"></button>
    <button class="iconbtn" id="theme" title="Toggle theme"></button>
    <!-- Avatar slot: filled by a React portal when there is a session (see
         BoardApp). It sits here, not outside the pill, so the avatar stays part of
         the island next to the theme button. -->
    <span id="avatarSlot" class="avatar-slot"></span>
  </div>

  <!-- Save badge: it tells the truth about the state (saving/saved/error). It
       stays visible while there is something to say, unlike the toast, which
       fades out and therefore cannot express "not saved". -->
  <div class="savestate" id="saveState" role="status" aria-live="polite" hidden>
    <span class="dot" aria-hidden="true"></span><span class="txt"></span>
  </div>

  <div class="toast" id="toast">saved</div>
`;

interface InitDeps {
  status: string;
  client: ApiClient;
}

// Ports the imperative logic from the demo. Returns a cleanup function.
/** What initBoardApp gives React: cleanup plus what BoardSwitcher needs. */
interface BoardAppHandle {
  cleanup: () => void;
  manager: BoardManager;
  metaStore: BoardMetaStore;
  commentStore: CommentStore;
  board: Board;
  /** The island toast, so the React layer can give feedback with the same look. */
  flash: (msg: string) => void;
}

function initBoardApp(root: HTMLElement, deps: InitDeps): BoardAppHandle {
  const $ = (id: string): any => root.querySelector('#' + CSS.escape(id));
  const $1 = (sel: string): any => root.querySelector(sel);
  const $$ = (sel: string): any[] => Array.from(root.querySelectorAll(sel));

  // Images go to the bucket (R2) and the board stores only the URL. Embedding
  // them as data URLs would make the binary travel on every workspace save — see
  // lib/uploads. Anonymous users have no session to sign an upload, so in that
  // case images stay embedded.
  const uploadImage =
    deps.status === 'authenticated' ? createImageUploader(deps.client) : undefined;

  const board = new Board($('board'), {
    grid: true,
    theme: 'light',
    selectionToolbar: false,
    uploadImage,
  });  const manager = new BoardManager(board, { defaultName: 'Board 1' });
  // Per-board metadata (starred / last change). It lives outside the snapshot
  // because the core's BoardDocument only has { id, name, snapshot }.
  const metaStore = new BoardMetaStore();
  // Per-board comments. Also outside the drawing snapshot (see comments.ts).
  const commentStore = new CommentStore();

  const icon = (name: string) => ICONS[name as keyof typeof ICONS] || '';
  const svg = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const HAMB = svg('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>');
  const CHECKLIST = svg('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>');
  // Sticky: a note with a folded corner (lucide StickyNote) — the fold is only in
  // the icon; the element on the board is flat, by design.
  const STICKY_ICON = svg('<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2Z"/><path d="M16 21v-5h5"/>');
  // Frame: moldura de enquadramento (lucide Frame).
  const FRAME_ICON = svg('<line x1="22" y1="6" x2="2" y2="6"/><line x1="22" y1="18" x2="2" y2="18"/><line x1="6" y1="2" x2="6" y2="22"/><line x1="18" y1="2" x2="18" y2="22"/>');
  const MINIMIZE = svg('<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3"/>');
  const ALIGN_LEFT = svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="15" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/>');
  const ALIGN_CENTER = svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/>');
  const ALIGN_RIGHT = svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="6" y1="18" x2="20" y2="18"/>');
  const VALIGN_TOP = svg('<line x1="5" y1="5" x2="19" y2="5"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="15" x2="14" y2="15"/>');
  const VALIGN_MIDDLE = svg('<line x1="5" y1="12" x2="19" y2="12"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="17" x2="16" y2="17"/>');
  const ZOOM_IN = svg('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>');
  const ZOOM_OUT = svg('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>');
  // Auto-layout: each icon draws the arrangement its button applies.
  const LAYOUT_ICONS: Record<string, string> = {
    grid: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
    horizontal: svg('<rect x="2" y="8" width="6" height="8" rx="1"/><rect x="9" y="8" width="6" height="8" rx="1"/><rect x="16" y="8" width="6" height="8" rx="1"/>'),
    vertical: svg('<rect x="8" y="2" width="8" height="6" rx="1"/><rect x="8" y="9" width="8" height="6" rx="1"/><rect x="8" y="16" width="8" height="6" rx="1"/>'),
    circle: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="3.5" r="1.6" fill="currentColor"/><circle cx="20.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="20.5" r="1.6" fill="currentColor"/><circle cx="3.5" cy="12" r="1.6" fill="currentColor"/>'),
  };

  const SHAPE_SVGS: Record<string, string> = {
    diamond: svg('<path d="M12 3 21 12 12 21 3 12z"/>'),
    triangle: svg('<path d="M12 4 21 20 3 20z"/>'),
    hexagon: svg('<path d="M7.5 4 16.5 4 21 12 16.5 20 7.5 20 3 12z"/>'),
    parallelogram: svg('<path d="M8 5 21 5 16 19 3 19z"/>'),
    cylinder: svg('<path d="M4 6c0-1.6 3.6-3 8-3s8 1.4 8 3v12c0 1.6-3.6 3-8 3s-8-1.4-8-3z"/><path d="M4 6c0 1.6 3.6 3 8 3s8-1.4 8-3"/>'),
    cloud: svg('<path d="M7 18h10a4 4 0 0 0 .5-8 5 5 0 0 0-9.6-1.3A3.5 3.5 0 0 0 7 18z"/>'),
    document: svg('<path d="M5 4 19 4 19 16 C 16 20 15 14 12 16.5 C 9 19 8 14 5 16.5 Z"/>'),
    star: svg('<path d="M12 3 14.6 9.2 21 9.6 16 13.8 17.6 20 12 16.4 6.4 20 8 13.8 3 9.6 9.4 9.2z"/>'),
    pill: svg('<rect x="3" y="7" width="18" height="10" rx="5"/>'),
    // Stick figure: head, torso, arms and legs.
    person: svg('<circle cx="12" cy="5" r="3"/><path d="M12 8v7M6 11h12M12 15l-4 6M12 15l4 6"/>'),
    cube: svg('<path d="M4 8 9 3h11v11l-5 5H4z"/><path d="M4 8h11v11M15 8l5-5"/>'),
    browser: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r=".8" fill="currentColor"/><circle cx="9" cy="6.5" r=".8" fill="currentColor"/>'),
    folder: svg('<path d="M3 7h6l2 3h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'),
    callout: svg('<path d="M20 15a2 2 0 0 1-2 2H9l-4 4V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2Z"/>'),
    cross: svg('<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>'),
    arrowBlock: svg('<path d="M3 9h10V4l8 8-8 8v-5H3z"/>'),
  };
  const SHAPES: [string, string][] = [
    ['diamond', 'Diamond / decision'],
    ['pill', 'Start / end'],
    ['parallelogram', 'Input / output'],
    ['hexagon', 'Preparation'],
    ['cylinder', 'Database'],
    ['cloud', 'Cloud / service'],
    ['document', 'Document'],
    ['triangle', 'Triangle'],
    ['star', 'Star'],
    ['person', 'Person / actor (stick figure)'],
    ['cube', 'Service / server'],
    ['browser', 'Screen / browser'],
    ['folder', 'Folder'],
    ['callout', 'Speech balloon'],
    ['cross', 'Cross'],
    ['arrowBlock', 'Block arrow'],
  ];
  const TEMPLATES_ICON = svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>');
  // Note: a sheet with text lines. Shortcut: an arrow leaving the frame (the same
  // "open somewhere else" metaphor used when drawing the element).
  const NOTE_ICON = svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>');
  const LINK_ICON = svg('<path d="M13 4h7v7"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>');

  // ---------- Icons nas tools ----------
  const toolIcon: Record<string, string> = {
    selection: 'cursor', hand: 'hand', rectangle: 'rectangle', ellipse: 'ellipse',
    line: 'diagonal', arrow: 'arrowRight', freedraw: 'pencil', text: 'text',
    image: 'image', embed: 'globe',
  };
  $$('#toolbar button[data-tool]').forEach((btn: any) => {
    btn.innerHTML = icon(toolIcon[btn.dataset.tool]);
  });
  $1('#toolbar [data-tool="tasks"]').innerHTML = CHECKLIST;
  $1('#toolbar [data-tool="frame"]').innerHTML = FRAME_ICON;
  $1('#toolbar [data-tool="note"]').innerHTML = NOTE_ICON;
  $1('#toolbar [data-tool="link"]').innerHTML = LINK_ICON;

  // ---------- Sticky color picker ----------
  const stickyDD = $('stickyDD');
  const stickyBtn = $('stickyBtn');
  const stickyPanel = $('stickyPanel');
  // The palette comes from core (STICKY_COLORS): pastels plus saturated tones.
  // These colors used to be duplicated here and drifted out of sync with the
  // package.
  const STICKY_PALETTE = [...STICKY_COLORS];
  let stickyColor = STICKY_PALETTE[0];
  stickyBtn.innerHTML = STICKY_ICON;
  for (const c of STICKY_PALETTE) {
    const btn = document.createElement('button');
    btn.title = 'Post-it ' + c;
    btn.style.background = c;
    btn.style.border = '2px solid ' + (c === stickyColor ? 'var(--ui-accent)' : 'transparent');
    btn.style.borderRadius = '10px';
    btn.onclick = () => {
      stickyColor = c;
      board.setStickyColor(c);
      board.setTool('sticky');
      stickyDD.open = false;
      Array.from(stickyPanel.children).forEach((x: any) => {
        x.style.border = '2px solid ' + (x.style.background === btn.style.background ? 'var(--ui-accent)' : 'transparent');
      });
    };
    stickyPanel.appendChild(btn);
  }

  // ---------- Shapes palette ----------
  const shapesDD = $('shapesDD');
  const shapesBtn = $('shapesBtn');
  const shapesPanel = $('shapesPanel');
  shapesBtn.innerHTML = SHAPE_SVGS[board.getShapeKind()] || SHAPE_SVGS.diamond;
  for (const [kind, label] of SHAPES) {
    const btn = document.createElement('button');
    btn.title = label;
    btn.innerHTML = SHAPE_SVGS[kind];
    btn.onclick = () => {
      board.setShapeKind(kind as any);
      shapesBtn.innerHTML = SHAPE_SVGS[kind];
      shapesDD.open = false;
    };
    shapesPanel.appendChild(btn);
  }

  // ---------- Templates tab ----------
  // The content comes from TEMPLATES (lib/boards/templates.ts), empty today. The
  // tab exists and fills itself once a template is registered; inserting is a
  // single undo step, centered in the viewport and already selected.
  const templatesDD: HTMLDetailsElement = $('templatesDD');
  const templatesBtn: HTMLElement = $('templatesBtn');
  const templatesPanel: HTMLElement = $('templatesPanel');
  templatesBtn.innerHTML = TEMPLATES_ICON;
  const insertTemplate = (t: Template) => {
    const { width, height } = templateSize(t);
    // Viewport center in world space: the set appears where the user is looking.
    const host: HTMLElement = $('board');
    const center = board.camera.screenToWorld(host.clientWidth / 2, host.clientHeight / 2);
    const els = t.build({ x: center.x - width / 2, y: center.y - height / 2 });
    board.applyOperations(els.map((element) => ({ op: 'add' as const, element })));
    board.setSelection(els.map((e) => e.id));
    board.setTool('selection');
    flash(`${t.name} inserido`);
  };
  const renderTemplates = () => {
    templatesPanel.innerHTML = '';
    const groups = templatesByGroup();
    if (groups.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'templates-empty';
      empty.textContent = 'Nenhum template ainda.';
      templatesPanel.appendChild(empty);
      return;
    }
    for (const [grupo, list] of groups) {
      const title = document.createElement('div');
      title.className = 'sec';
      title.textContent = grupo;
      templatesPanel.appendChild(title);
      for (const t of list) {
        const item = document.createElement('button');
        item.className = 'template-item';
        item.innerHTML = `<span class="nm">${t.name}</span><span class="ht">${t.hint}</span>`;
        item.onclick = () => {
          insertTemplate(t);
          templatesDD.open = false;
        };
        templatesPanel.appendChild(item);
      }
    }
  };
  renderTemplates();

  $('undo').innerHTML = icon('undo');
  $('redo').innerHTML = icon('redo');
  $('zoomOut').innerHTML = ZOOM_OUT;
  $('zoomIn').innerHTML = ZOOM_IN;
  $('hambBtn').innerHTML = HAMB;
  // The board selector icons (glyph, chevron, "new board") are now rendered by
  // BoardSwitcher in React.
  const menuIcons: Record<string, string> = { share: 'globe', fit: 'maximize', png: 'image', export: 'download', import: 'upload', clear: 'trash' };
  $$('#hamb .item[data-act]').forEach((b: any) => {
    b.querySelector('.ico').innerHTML = icon(menuIcons[b.dataset.act]);
  });

  // ---------- Board selector ----------
  // The board list UI lives in the React BoardSwitcher component (portaled into
  // #boardSwitcherSlot). Only the imperative part remains here.
  const hamb = $('hamb');

  // ---------- Toast ----------
  const toast = $('toast');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const flash = (msg: string) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1100);
  };

  // ---------- Save badge ----------
  // "Saved" only appears once the server confirmed. The toast used to say "saved to
  // the cloud" even when the request failed, which is worse than saying nothing.
  const saveState = $('saveState');
  const saveTxt = saveState.querySelector('.txt');
  let saveHideTimer: ReturnType<typeof setTimeout> | undefined;
  const SAVE_LABEL: Record<SaveState, string> = {
    idle: '',
    pending: 'unsaved changes',
    saving: 'saving…',
    saved: 'saved',
    error: 'could not save — retrying',
  };
  const paintSaveState = (state: SaveState) => {
    clearTimeout(saveHideTimer);
    if (state === 'idle') {
      saveState.hidden = true;
      return;
    }
    saveState.hidden = false;
    saveState.dataset.state = state;
    saveTxt.textContent = SAVE_LABEL[state];
    // "Saved" is transient: it disappears after a while. Errors and pending
    // changes STAY.
    if (state === 'saved') {
      saveHideTimer = setTimeout(() => {
        saveState.hidden = true;
      }, 1600);
    }
  };

  // ---------- Persistence: localStorage (anonymous) or backend (signed in) ----------
  // What goes to storage is an envelope { workspace, meta, folders, comments }:
  // the BoardManager snapshot plus everything that does not fit in BoardDocument.
  // All the orchestration (when to write, what to prune, what to do on load and
  // what to do on failure) lives in lib/boards/workspace-sync.ts — tests included.
  const LOCAL_KEY = 'omniboard-ws';
  const localEnvelope: EnvelopeStorage = {
    read() {
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        return { envelope: raw ? JSON.parse(raw) : null };
      } catch (err) {
        reportError('localStorage.read', err);
        return { envelope: null };
      }
    },
    write(envelope) {
      // No try/catch: a full quota or private mode must BECOME an error state in
      // the UI, not vanish. Retrying is the sync layer's job.
      localStorage.setItem(LOCAL_KEY, JSON.stringify(envelope));
      return {};
    },
  };
  const cloudEnvelope: EnvelopeStorage = {
    async read() {
      const r: any = await deps.client.get('/workspace');
      return { envelope: r?.workspace?.data ?? null, version: r?.workspace?.version };
    },
    async write(envelope, version) {
      try {
        const r: any = await deps.client.put('/workspace', { data: envelope, version });
        return { version: r?.workspace?.version };
      } catch (err) {
        // 409: another tab wrote first. The body already carries the server
        // state, so the sync layer reloads without another network round trip.
        const e = err as { status?: number; body?: any };
        if (e?.status === 409) {
          throw new VersionConflict({
            envelope: e.body?.workspace?.data ?? null,
            version: e.body?.workspace?.version,
          });
        }
        throw err;
      }
    },
  };

  const authenticated = deps.status === 'authenticated';
  const sync = syncWorkspace({
    manager,
    metaStore,
    commentStore,
    storage: authenticated ? cloudEnvelope : localEnvelope,
    // On the first login whatever was in localStorage goes up to the cloud.
    migrateFrom: authenticated ? localEnvelope : undefined,
    debounceMs: 500,
    onState: (state) => paintSaveState(state),
    onConflict: () =>
      flash('Changed in another tab — reloaded with the latest version'),
    onError: (err) => reportError('workspace.save', err),
  });

  // Image upload failed: the image was embedded instead (nothing is lost), but the
  // user needs to know — embedded, it weighs on every workspace save.
  board.on('imageUploadError', (e: any) => {
    const err = e.error;
    reportError('upload.image', err);
    flash(
      err instanceof UploadError && !err.unavailable
        ? `${err.message} — image inserted locally`
        : 'Upload unavailable — image inserted locally',
    );
  });

  // Older boards keep images as base64 inside the snapshot. After the load, upload
  // whatever stayed embedded and swap it for a URL — that shrinks the payload of
  // every save that follows. Silent when there is nothing to migrate.
  if (uploadImage) {
    void sync.ready.then(async () => {
      const r = await migrateEmbeddedImages(board, uploadImage);
      if (r.migrated > 0) {
        flash(
          r.migrated === 1
            ? '1 image moved to storage'
            : `${r.migrated} imagens movidas para o storage`,
        );
      }
    });
  }

  // ---------- Tools ----------
  const toolbar = $('toolbar');
  const refreshTool = (tool: string) => {
    toolbar.querySelectorAll('button[data-tool]').forEach((b: any) =>
      b.classList.toggle('active', b.dataset.tool === tool));
    shapesBtn.classList.toggle('active', tool === 'shape');
    stickyBtn.classList.toggle('active', tool === 'sticky');
  };
  toolbar.addEventListener('click', (e: any) => {
    const btn = e.target.closest('button');
    if (btn?.dataset.tool) board.setTool(btn.dataset.tool);
  });
  board.on('toolChange', (e: any) => refreshTool(e.tool));
  refreshTool(board.getTool());

  // ---------- Comment mode ----------
  // The state lives here (imperative layer) and is mirrored to React through an
  // event: the comments overlay is a component, but the button belongs to the
  // island built via innerHTML.
  const COMMENT_ICON = svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>');
  const commentBtn = $('comment');
  commentBtn.innerHTML = COMMENT_ICON;
  let commentMode = false;
  const COMMENT_EVENT = 'omniboard:comment-mode';
  const applyCommentMode = (on: boolean) => {
    commentMode = on;
    commentBtn.classList.toggle('active', on);
  };
  const setCommentMode = (on: boolean) => {
    applyCommentMode(on);
    window.dispatchEvent(new CustomEvent(COMMENT_EVENT, { detail: on }));
  };
  // React also turns the mode off (after creating a pin). We apply it without
  // re-dispatching, otherwise both sides would echo each other.
  const onCommentEvent = (e: Event) => applyCommentMode(Boolean((e as CustomEvent).detail));
  window.addEventListener(COMMENT_EVENT, onCommentEvent);
  commentBtn.onclick = () => setCommentMode(!commentMode);
  // Escape leaves the mode; "C" toggles it (the tooltip promises the shortcut).
  // Ignored while focus is in a text field, otherwise typing would issue commands.
  const onCommentKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing =
      target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
    if (e.key === 'Escape' && commentMode) setCommentMode(false);
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'c') {
      setCommentMode(!commentMode);
    }
  };
  document.addEventListener('keydown', onCommentKey);

  // ---------- Theme ----------
  const themeBtn = $('theme');
  document.body.dataset.theme = board.getTheme();
  themeBtn.innerHTML = board.getTheme() === 'dark' ? icon('sun') : icon('moon');
  board.on('themeChange', (e: any) => {
    document.body.dataset.theme = e.theme;
    themeBtn.innerHTML = e.theme === 'dark' ? icon('sun') : icon('moon');
  });
  themeBtn.onclick = () => board.toggleTheme();

  // ---------- Floating formatting bar ----------
  const props = $('props');
  const strokeSwatches = $('strokeSwatches');
  const bgSwatches = $('bgSwatches');
  const widthSeg = $('widthSeg');
  const opacityInput = $('opacity');
  const opacityVal = $('opacityVal');
  const textSection = $('textSection');
  const fontFamilyInput = $('fontFamily');
  const fontSizeInput = $('fontSize');
  const fontBold = $('fontBold');
  const fontItalic = $('fontItalic');
  const textAlignSeg = $('textAlignSeg');
  const verticalAlignSeg = $('verticalAlignSeg');

  // Triggers: each one summarizes the current value and opens its popover.
  const strokeChip: HTMLElement = $('strokeChip');
  const bgChip: HTMLElement = $('bgChip');
  const stickyChip: HTMLElement = $('stickyChip');
  const widthChip: HTMLElement = $('widthChip');
  const opacityChip: HTMLElement = $('opacityChip');
  const propsDDs: HTMLDetailsElement[] = ['strokeDD', 'bgDD', 'stickyColorDD', 'widthDD', 'textDD', 'opacityDD']
    .map((id) => $(id))
    .filter(Boolean);
  const closePropsDDs = (exceto?: HTMLDetailsElement) => {
    for (const dd of propsDDs) if (dd !== exceto) dd.open = false;
  };
  // Only one popover open at a time: two of them overlap over the canvas.
  for (const dd of propsDDs) {
    dd.addEventListener('toggle', () => {
      if (dd.open) closePropsDDs(dd);
    });
  }

  /** Paints the trigger square with the current color (or the "no color" slash). */
  const paintChip = (chip: HTMLElement, color: string) => {
    if (!chip) return;
    const noColor = !color || color === 'transparent';
    chip.innerHTML = `<span class="chip-dot${noColor ? ' none' : ''}"></span>`;
    if (!noColor) (chip.firstElementChild as HTMLElement).style.color = color;
  };
  const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
  const BGS = ['transparent', '#ffec99', '#ffc9c9', '#b2f2bb', '#a5d8ff'];
  const FONT_OPTIONS: [string, string][] = [
    ['system-ui, -apple-system, sans-serif', 'Sistema'],
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['Georgia, serif', 'Georgia'],
    ["'Times New Roman', Times, serif", 'Times'],
    ["'Courier New', Courier, monospace", 'Courier'],
    ['Verdana, Geneva, sans-serif', 'Verdana'],
  ];
  const norm = (c: string) => (c || '').toLowerCase();

  fontFamilyInput.innerHTML = FONT_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  textAlignSeg.querySelector('[data-align="left"]').innerHTML = ALIGN_LEFT;
  textAlignSeg.querySelector('[data-align="center"]').innerHTML = ALIGN_CENTER;
  textAlignSeg.querySelector('[data-align="right"]').innerHTML = ALIGN_RIGHT;
  verticalAlignSeg.querySelector('[data-valign="top"]').innerHTML = VALIGN_TOP;
  verticalAlignSeg.querySelector('[data-valign="middle"]').innerHTML = VALIGN_MIDDLE;

  $('pFront').innerHTML = icon('bringForward');
  $('pBack').innerHTML = icon('sendBackward');
  $('pDup').innerHTML = icon('copy');
  $('pDel').innerHTML = icon('trash');
  $('pFront').onclick = () => board.bringToFront();
  $('pBack').onclick = () => board.sendToBack();
  $('pDup').onclick = () => board.duplicateSelected();
  $('pDel').onclick = () => board.deleteSelected();

  const currentStyle = (): any => {
    const ids = board.getSelectedIds();
    if (ids.length) {
      const el = board.getElements().find((e: any) => e.id === ids[0]);
      if (el) return el;
    }
    return board.getStyle();
  };

  const currentTextStyle = (): any => {
    const ids = board.getSelectedIds();
    for (const id of ids) {
      const el: any = board.getElements().find((e: any) => e.id === id);
      if (el?.type === 'text') {
        return {
          ...board.getTextStyle(),
          fontSize: el.fontSize,
          fontFamily: el.fontFamily,
          fontWeight: el.fontWeight || 'normal',
          fontStyle: el.fontStyle || 'normal',
          textAlign: el.textAlign || 'left',
          verticalAlign: el.verticalAlign || 'top',
        };
      }
      if (el && el.type !== 'text') {
        return {
          ...board.getLabelStyle(),
          fontSize: el.labelFontSize || board.getLabelStyle().fontSize,
          fontFamily: el.labelFontFamily || board.getLabelStyle().fontFamily,
          fontWeight: el.labelFontWeight || board.getLabelStyle().fontWeight,
          fontStyle: el.labelFontStyle || board.getLabelStyle().fontStyle,
          textAlign: el.labelTextAlign || board.getLabelStyle().textAlign,
          verticalAlign: el.labelVerticalAlign || board.getLabelStyle().verticalAlign,
        };
      }
    }
    return board.getTextStyle();
  };

  const hasTextSelection = () => {
    const ids = new Set(board.getSelectedIds());
    return board.getElements().some((e: any) => ids.has(e.id) && e.type === 'text');
  };
  const hasLabelSelection = () => {
    const ids = new Set(board.getSelectedIds());
    return board.getElements().some((e: any) => ids.has(e.id) && e.type !== 'text');
  };
  const applyTextPanelStyle = (style: any) => {
    if (hasTextSelection()) board.setTextStyle(style);
    else if (hasLabelSelection()) board.setLabelStyle(style);
    else board.setTextStyle(style);
  };

  const markSwatches = (container: any, colors: string[], current: string) => {
    Array.from(container.querySelectorAll('.swatch')).forEach((sw: any, i: number) => {
      if (i < colors.length) sw.classList.toggle('active', norm(colors[i]) === norm(current));
      else sw.classList.remove('active');
    });
  };

  const buildSwatches = (container: any, colors: string[], current: string, apply: (c: string) => void) => {
    container.innerHTML = '';
    for (const c of colors) {
      const sw = document.createElement('button');
      sw.className = 'swatch' + (c === 'transparent' ? ' none' : '');
      if (c !== 'transparent') sw.style.background = c;
      sw.title = c === 'transparent' ? 'Sem preenchimento' : c;
      sw.onclick = () => { apply(c); markSwatches(container, colors, c); };
      container.appendChild(sw);
    }
    const custom = document.createElement('label');
    custom.className = 'swatch custom';
    custom.title = 'Cor personalizada';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = current && current !== 'transparent' ? current : '#000000';
    inp.oninput = () => { apply(inp.value); markSwatches(container, colors, inp.value); };
    custom.appendChild(inp);
    container.appendChild(custom);
    markSwatches(container, colors, current);
  };

  function populateSidebar() {
    const st = currentStyle();
    buildSwatches(strokeSwatches, STROKES, st.strokeColor, (c) => {
      board.setStyle({ strokeColor: c });
      paintChip(strokeChip, c);
    });
    buildSwatches(bgSwatches, BGS, st.backgroundColor, (c) => {
      board.setStyle({ backgroundColor: c });
      paintChip(bgChip, c);
    });
    paintChip(strokeChip, st.strokeColor);
    paintChip(bgChip, st.backgroundColor);
    const width = st.strokeWidth ?? 2;
    Array.from(widthSeg.children).forEach((b: any) =>
      b.classList.toggle('active', Number(b.dataset.w) === width));
    // The trigger shows the chosen thickness, not a generic icon.
    widthChip.innerHTML = `<span class="dash" style="width:15px;height:${Math.min(5, width + 1)}px"></span>`;
    const opacity = Math.round((st.opacity ?? 1) * 100);
    opacityInput.value = String(opacity);
    updateOpacity(opacity);
    populateTextControls();
  }

  /** Reflects opacity on the trigger (a hollower circle means more transparent). */
  function updateOpacity(pct: number) {
    opacityVal.textContent = `${pct}%`;
    opacityChip.innerHTML = svg(
      `<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" opacity="${Math.max(0.15, pct / 100).toFixed(2)}" stroke="none"/>`,
    );
  }

  // Set by applyGroups: keeps populateTextControls from showing the text block
  // again on a type where it makes no sense (image, embed…).
  let textGroupAllowed = true;

  function populateTextControls() {
    const showText =
      textGroupAllowed &&
      (hasTextSelection() || hasLabelSelection() || board.getTool() === 'text');
    textSection.style.display = showText ? '' : 'none';
    if (!showText) return;
    const ts = currentTextStyle();
    fontFamilyInput.value = ts.fontFamily;
    fontSizeInput.value = String(ts.fontSize);
    fontBold.classList.toggle('active', ts.fontWeight === 'bold');
    fontItalic.classList.toggle('active', ts.fontStyle === 'italic');
    textAlignSeg.querySelectorAll('button').forEach((b: any) =>
      b.classList.toggle('active', b.dataset.align === ts.textAlign));
    verticalAlignSeg.querySelectorAll('button').forEach((b: any) =>
      b.classList.toggle('active', b.dataset.valign === ts.verticalAlign));
  }

  fontFamilyInput.onchange = () => { applyTextPanelStyle({ fontFamily: fontFamilyInput.value }); populateTextControls(); };
  fontSizeInput.onchange = () => {
    const n = Math.max(8, Math.min(120, Number(fontSizeInput.value) || 20));
    applyTextPanelStyle({ fontSize: n });
    populateTextControls();
  };
  fontBold.onclick = () => {
    const ts = currentTextStyle();
    applyTextPanelStyle({ fontWeight: ts.fontWeight === 'bold' ? 'normal' : 'bold' });
    populateTextControls();
  };
  fontItalic.onclick = () => {
    const ts = currentTextStyle();
    applyTextPanelStyle({ fontStyle: ts.fontStyle === 'italic' ? 'normal' : 'italic' });
    populateTextControls();
  };
  textAlignSeg.querySelectorAll('button').forEach((b: any) => {
    b.onclick = () => { applyTextPanelStyle({ textAlign: b.dataset.align }); populateTextControls(); };
  });
  verticalAlignSeg.querySelectorAll('button').forEach((b: any) => {
    b.onclick = () => { applyTextPanelStyle({ verticalAlign: b.dataset.valign }); populateTextControls(); };
  });

  widthSeg.querySelectorAll('button').forEach((b: any) => {
    b.onclick = () => {
      board.setStyle({ strokeWidth: Number(b.dataset.w) });
      Array.from(widthSeg.children).forEach((x: any) => x.classList.toggle('active', x === b));
      widthChip.innerHTML = `<span class="dash" style="width:15px;height:${Math.min(5, Number(b.dataset.w) + 1)}px"></span>`;
      (($('widthDD')) as HTMLDetailsElement).open = false;
    };
  });
  opacityInput.oninput = () => {
    const pct = Number(opacityInput.value);
    board.setStyle({ opacity: pct / 100 });
    updateOpacity(pct);
  };

  const stickyColorSection = $('stickyColorSection');
  const stickySwatches = $('stickySwatches');
  function populateStickyColors() {
    const ids = board.getSelectedIds();
    if (!ids.length) { stickyColorSection.style.display = 'none'; return; }
    const el: any = board.getElements().find((e: any) => e.id === ids[0]);
    if (!el || el.type !== 'sticky') { stickyColorSection.style.display = 'none'; return; }
    stickyColorSection.style.display = '';
    stickySwatches.innerHTML = '';
    const current = norm(el.color || STICKY_COLORS[0]);
    paintChip(stickyChip, el.color || STICKY_COLORS[0]);
    for (const c of STICKY_COLORS) {
      const sw = document.createElement('button');
      sw.className = 'swatch' + (norm(c) === current ? ' active' : '');
      sw.style.background = c;
      sw.title = c;
      sw.onclick = () => {
        board.updateElement(ids[0], { color: c } as any);
        populateStickyColors();
      };
      stickySwatches.appendChild(sw);
    }
  }

  /**
   * Places the formatting bar above the selection, following pan and zoom.
   *
   * With no selection (while drawing) there is nothing to follow: in that case it
   * anchors under the tool island. If it does not fit above the selection, it goes
   * below — the case of an element pinned to the top of the viewport.
   */
  const GAP_BAR = 12;
  const TOP_MIN = 58; // abaixo das ilhas do top
  function positionProps() {
    const ids = new Set(board.getSelectedIds());
    const sel = board.getElements().filter((e: any) => ids.has(e.id));
    const w = props.offsetWidth || 240;
    const h = props.offsetHeight || 34;

    if (!sel.length) {
      props.style.left = '50%';
      props.style.top = `${TOP_MIN}px`;
      props.style.transform = 'translateX(-50%)';
      return;
    }

    const b = getElementsBounds(sel as any);
    // getElementsBounds returns null for sets with no usable geometry.
    if (!b) return;
    const tl = board.camera.worldToScreen(b.minX, b.minY);
    const br = board.camera.worldToScreen(b.maxX, b.maxY);

    let left = (tl.x + br.x) / 2 - w / 2;
    let top = tl.y - h - GAP_BAR;
    if (top < TOP_MIN) top = br.y + GAP_BAR;

    // Keeps the bar inside the window.
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    top = Math.max(TOP_MIN, Math.min(top, window.innerHeight - h - 8));

    props.style.transform = 'none';
    props.style.left = `${Math.round(left)}px`;
    props.style.top = `${Math.round(top)}px`;
  }

  /**
   * Which groups of the bar make sense for each element type.
   *
   * This is what separates a contextual bar from a generic sidebar: a sticky note
   * has no "stroke" and no "fill" (its color is the note's), an arrow has no fill.
   * Showing everything all the time is what made the bar cluttered.
   */
  const GROUPS_BY_TYPE: Record<string, string[]> = {
    rectangle: ['stroke', 'bg', 'width', 'text', 'opacity', 'layers', 'actions'],
    ellipse: ['stroke', 'bg', 'width', 'text', 'opacity', 'layers', 'actions'],
    shape: ['stroke', 'bg', 'width', 'text', 'opacity', 'layers', 'actions'],
    line: ['stroke', 'width', 'opacity', 'layers', 'actions'],
    arrow: ['stroke', 'width', 'opacity', 'layers', 'actions'],
    freedraw: ['stroke', 'width', 'opacity', 'layers', 'actions'],
    text: ['stroke', 'text', 'opacity', 'layers', 'actions'],
    sticky: ['stickyColor', 'text', 'opacity', 'layers', 'actions'],
    frame: ['stroke', 'bg', 'width', 'opacity', 'layers', 'actions'],
    // Shortcut and note carry their own content (target / text in the modal):
    // stroke style and labels do not apply.
    link: ['opacity', 'layers', 'actions'],
    note: ['opacity', 'layers', 'actions'],
    image: ['opacity', 'layers', 'actions'],
    embed: ['opacity', 'layers', 'actions'],
    tasks: ['bg', 'opacity', 'layers', 'actions'],
  };
  const GROUP_SECTIONS: Record<string, string> = {
    stroke: 'strokeSection',
    bg: 'bgSection',
    width: 'widthSection',
    text: 'textSection',
    opacity: 'opacitySection',
    layers: 'layersSection',
    actions: 'actionsSection',
    stickyColor: 'stickyColorSection',
  };

  /** Applies to the bar the groups relevant to the types in play. */
  function applyGroups(types: string[]) {
    const visible = new Set<string>();
    for (const t of types) {
      for (const g of GROUPS_BY_TYPE[t] ?? ['stroke', 'bg', 'width', 'opacity']) {
        visible.add(g);
      }
    }
    for (const [grupo, secao] of Object.entries(GROUP_SECTIONS)) {
      const node = $(secao);
      if (node) node.style.display = visible.has(grupo) ? '' : 'none';
    }
    textGroupAllowed = visible.has('text');
    return visible;
  }

  function updateSidebar() {
    const tool = board.getTool();
    const drawing = !['selection', 'hand'].includes(tool);
    const ids = new Set(board.getSelectedIds());
    const sel = board.getElements().filter((e: any) => ids.has(e.id));
    const show = sel.length > 0 || drawing;
    props.style.display = show ? 'flex' : 'none';
    if (!show) {
      // A hidden bar with an open popover would come back already open next time.
      closePropsDDs();
      return;
    }

    // With a selection the element types decide; while drawing, the tool does.
    const types = sel.length
      ? [...new Set(sel.map((e: any) => e.type as string))]
      : [tool];
    const visible = applyGroups(types);

    populateSidebar();
    // populateStickyColors and the text block decide on their own whether they
    // have content; we respect the group decision made above.
    if (visible.has('stickyColor')) populateStickyColors();
    positionProps();
  }
  board.on('selectionChange', updateSidebar);
  board.on('toolChange', updateSidebar);
  // The bar follows the selection: moving/resizing the element or the camera
  // repositions it.
  board.on('change', () => { if (props.style.display !== 'none') positionProps(); });
  board.on('cameraChange', () => { if (props.style.display !== 'none') positionProps(); });
  window.addEventListener('resize', positionProps);
  updateSidebar();

  // ---------- Undo / redo / zoom ----------
  $('undo').onclick = () => board.undo();
  $('redo').onclick = () => board.redo();
  $('zoomIn').onclick = () => board.zoomIn();
  $('zoomOut').onclick = () => board.zoomOut();

  // ---------- Lock ----------
  const lockBtn = $('lock');
  lockBtn.innerHTML = icon('unlock');
  board.on('lockChange', (e: any) => {
    lockBtn.innerHTML = e.locked ? icon('lock') : icon('unlock');
    lockBtn.classList.toggle('active', e.locked);
    lockBtn.title = e.locked ? 'Navigation mode on — click to edit' : 'Navigation mode (interact without editing)';
    toolbar.classList.toggle('locked', e.locked);
  });
  lockBtn.onclick = () => board.toggleLock();

  // ---------- Fullscreen ----------
  const fsBtn = $('fullscreen');
  const refreshFs = () => { fsBtn.innerHTML = document.fullscreenElement ? MINIMIZE : icon('maximize'); };
  refreshFs();
  fsBtn.onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };
  document.addEventListener('fullscreenchange', refreshFs);

  // ---------- Appearance ----------
  $('selColor').oninput = (e: any) => board.setAppearance({ selectionColor: e.target.value });
  $('gridSpace').oninput = (e: any) => board.setAppearance({ gridSpacing: Number(e.target.value) });
  $('handleSz').oninput = (e: any) => board.setAppearance({ handleSize: Number(e.target.value) });
  $('gridPattern').onchange = (e: any) => board.setAppearance({ gridPattern: e.target.value });

  // ---------- Search ----------
  const searchBox = $('searchBox');
  searchBox.onkeydown = (e: any) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const n = board.searchAndFocus(searchBox.value);
      flash(n > 0 ? `${n} resultado(s)` : 'Nada encontrado');
    }
    e.stopPropagation();
  };

  // ---------- Auto-layout ----------
  hamb.querySelectorAll('button[data-layout]').forEach((b: any) => {
    b.innerHTML = LAYOUT_ICONS[b.dataset.layout] ?? '';
    b.onclick = () => { board.autoLayout(b.dataset.layout); flash('Organizado: ' + b.dataset.layout); };
  });

  // ---------- Hamburger actions ----------
  hamb.querySelectorAll('.item[data-act]').forEach((b: any) => {
    b.onclick = async () => {
      const act = b.dataset.act;
      if (act === 'share') {
        // The modal is React; the menu is imperative DOM. A window event stitches
        // the two together.
        window.dispatchEvent(new CustomEvent('omniboard:share-open'));
      } else if (act === 'fit') board.zoomToFit();
      else if (act === 'focus') {
        board.toggleFocusMode();
        if (board.isFocusMode() && board.getSelectedIds().length === 0) flash('Modo foco ON — selecione um elemento');
        else flash(board.isFocusMode() ? 'Modo foco ON' : 'Modo foco OFF');
      } else if (act === 'celebrate') { board.celebrate(); }
      else if (act === 'clear') board.clear();
      else if (act === 'png') {
        try {
          const blob = await board.exportPNG({ scale: 2 });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = 'omniboard.png'; a.click();
          URL.revokeObjectURL(a.href);
        } catch (err: any) { alert(err.message); }
      } else if (act === 'export') {
        const blob = new Blob([JSON.stringify(manager.toJSON(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'omniboard-workspace.json'; a.click();
        URL.revokeObjectURL(a.href);
      } else if (act === 'import') {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'application/json';
        input.onchange = () => {
          const file = input.files?.[0]; if (!file) return;
          const reader = new FileReader();
          reader.onload = () => { try { manager.loadJSON(reader.result as string); } catch (err: any) { alert(err.message); } };
          reader.readAsText(file);
        };
        input.click();
      }
      hamb.open = false;
    };
  });

  // Closes dropdowns on outside click / keeps only one open.
  //
  // The boards panel is React (BoardSwitcher), not a <details>, so coordination
  // goes through a window event: whoever opens announces it, and the others close.
  // That avoids coupling the imperative logic to component state.
  const PILL_MENU_EVENT = 'omniboard:pill-menu-open';
  hamb.addEventListener('toggle', () => {
    if (hamb.open) window.dispatchEvent(new CustomEvent(PILL_MENU_EVENT, { detail: 'hamb' }));
  });
  const onPillMenu = (e: Event) => {
    if ((e as CustomEvent<string>).detail !== 'hamb') hamb.open = false;
  };
  window.addEventListener(PILL_MENU_EVENT, onPillMenu);

  const onOutside = (e: any) => {
    if (hamb.open && !hamb.contains(e.target)) hamb.open = false;
    if (shapesDD.open && !shapesDD.contains(e.target)) shapesDD.open = false;
    if (stickyDD.open && !stickyDD.contains(e.target)) stickyDD.open = false;
    if (templatesDD.open && !templatesDD.contains(e.target)) templatesDD.open = false;
    for (const dd of propsDDs) {
      if (dd?.open && !dd.contains(e.target)) dd.open = false;
    }
  };
  document.addEventListener('mousedown', onOutside);

  // ---------- Cleanup ----------
  const cleanup = () => {
    sync.detach();
    window.removeEventListener(PILL_MENU_EVENT, onPillMenu);
    window.removeEventListener(COMMENT_EVENT, onCommentEvent);
    window.removeEventListener('resize', positionProps);
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onCommentKey);
    document.removeEventListener('fullscreenchange', refreshFs);
    clearTimeout(toastTimer);
    try { board.destroy(); } catch { /* noop */ }
    try { manager.destroy(); } catch { /* noop */ }
  };

  // The manager and the stores are returned so React can mount BoardSwitcher.
  return { cleanup, manager, metaStore, commentStore, board, flash };
}

// BoardApp — the whole application is the board. No login gate: anonymous users
// save to localStorage; signed-in users save to the backend (/api/workspace),
// migrating whatever was local. Google login appears in a modal on arrival; once
// signed in, an avatar at the top opens the sign-out menu.
export function BoardApp() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { status, user, client, logout } = useAuth();
  const inited = useRef(false);
  const depsRef = useRef({ status, client });
  depsRef.current = { status, client };

  const [modalOpen, setModalOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Element inside the right pill where the avatar is portaled (see APP_HTML).
  const [avatarSlot, setAvatarSlot] = useState<HTMLElement | null>(null);
  // Slots plus dependencies of the board manager (in the left pill).
  const [switcher, setSwitcher] = useState<{
    trigger: HTMLElement | null;
    panel: HTMLElement | null;
    container: HTMLElement | null;
    manager: BoardManager;
    metaStore: BoardMetaStore;
    commentStore: CommentStore;
    board: Board;
    flash: (msg: string) => void;
  } | null>(null);
  // Active board: comments are per board.
  const [activeBoardId, setActiveBoardId] = useState('');
  const [commentMode, setCommentMode] = useState(false);
  // Share: opened from the menu (imperative DOM) through a window event.
  const [shareAberto, setShareAberto] = useState(false);
  const [activeBoardName, setActiveBoardName] = useState('Board');

  // Monta o board uma vez, at a auth resolve.
  useEffect(() => {
    if (status === 'loading') return;
    if (inited.current || !rootRef.current) return;
    inited.current = true;
    const root = rootRef.current;
    root.innerHTML = APP_HTML;
    const app = initBoardApp(root, depsRef.current);
    // The board is mounted via innerHTML (imperative logic), so the portal slots
    // only exist after this line. Storing them in state triggers the re-render
    // that creates the portals inside the pill.
    setAvatarSlot(root.querySelector<HTMLElement>('#avatarSlot'));
    setSwitcher({
      trigger: root.querySelector<HTMLElement>('#boardSwitcherSlot'),
      panel: root.querySelector<HTMLElement>('#boardPanelSlot'),
      container: root.querySelector<HTMLElement>('#pillLeft'),
      manager: app.manager,
      metaStore: app.metaStore,
      commentStore: app.commentStore,
      board: app.board,
      flash: app.flash,
    });
    setActiveBoardId(app.manager.getActiveId());
    return () => {
      setAvatarSlot(null);
      setSwitcher(null);
      app.cleanup();
      inited.current = false;
      root.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Menu pede para open o compartilhamento.
  useEffect(() => {
    const open = () => setShareAberto(true);
    window.addEventListener('omniboard:share-open', open);
    return () => window.removeEventListener('omniboard:share-open', open);
  }, []);

  // Comment mode is toggled by the island button (imperative DOM) and announced
  // by an event; the overlay is React and has to follow.
  useEffect(() => {
    const onMode = (e: Event) => setCommentMode(Boolean((e as CustomEvent).detail));
    window.addEventListener('omniboard:comment-mode', onMode);
    return () => window.removeEventListener('omniboard:comment-mode', onMode);
  }, []);

  // Comments are per board: follow the active board changing.
  useEffect(() => {
    const manager = switcher?.manager;
    if (!manager) return;
    const apply = () => {
      const id = manager.getActiveId();
      setActiveBoardId(id);
      setActiveBoardName(manager.list().find((d: { id: string; name: string }) => d.id === id)?.name ?? 'Board');
    };
    apply();
    const offDocs = manager.on('documentsChange', apply);
    const offActive = manager.on('activeChange', apply);
    return () => {
      offDocs();
      offActive();
    };
  }, [switcher]);

  // Abre o modal de login automaticamente ao entrar deslogado.
  useEffect(() => {
    if (status === 'unauthenticated' && !dismissed) setModalOpen(true);
    if (status === 'authenticated') setModalOpen(false);
  }, [status, dismissed]);

  // "Sign in with Google": a top-level navigation to the backend, which redirects
  // to Google's consent screen. Not a fetch — the browser has to leave the page.
  // The return lands on /auth/google/callback, which exchanges the code for tokens
  // and goes back to "/" already authenticated.
  const handleGoogle = () => {
    if (busy) return;
    setBusy(true);
    window.location.href = GOOGLE_LOGIN_URL;
  };

  const handleLogout = () => {
    setMenuOpen(false);
    void logout().finally(() => window.location.reload());
  };

  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <div id="app" ref={rootRef} className={status === 'authenticated' ? 'authed' : ''} />

      {/* Comments layer over the canvas. The mode is toggled by the island button
          (imperative) and reaches here through a window event. */}
      {switcher?.board && (
        <BoardComments
          board={switcher.board as never}
          store={switcher.commentStore}
          boardId={activeBoardId}
          author={user?.name || user?.email || 'You'}
          active={commentMode}
          onDone={() => {
            // Notifies the imperative layer (which owns the island button).
            window.dispatchEvent(new CustomEvent('omniboard:comment-mode', { detail: false }));
            setCommentMode(false);
          }}
        />
      )}

      {/* Long note: the card on the canvas is the preview; text is edited here. */}
      {switcher?.board && <BoardNoteModal board={switcher.board as never} />}

      {/* Shortcut between boards: picks the target and navigates when triggered. */}
      {switcher?.board && switcher.manager && (
        <BoardLinkPicker
          board={switcher.board as never}
          manager={switcher.manager as never}
          onNavigate={(msg) => switcher.flash(msg)}
          onMissing={() => switcher.flash('The board this shortcut points to no longer exists')}
        />
      )}

      {/* Share by link. Requires an account: the link serves the board from the
          server, and an anonymous board only exists in the browser. */}
      {switcher && status === 'authenticated' && (
        <BoardShareModal
          client={client}
          boardId={activeBoardId}
          boardName={activeBoardName}
          openId={shareAberto}
          onClose={() => setShareAberto(false)}
          onWarn={(msg) => switcher.flash(msg)}
        />
      )}
      {switcher && status !== 'authenticated' && shareAberto && (
        <div className="share-backdrop" onPointerDown={() => setShareAberto(false)}>
          <div className="share-modal" role="dialog" aria-label="Share board">
            <header>
              <h3>Share board</h3>
            </header>
            <p className="warning">
              Generating a link requires signing in: the board has to be saved in the
              cloud for someone else to open it. Without an account it only exists in
              this browser.
            </p>
            <footer>
              <button type="button" className="create" onClick={() => { setShareAberto(false); setModalOpen(true); }}>
                Sign in with Google
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Boards manager — the trigger goes in the pill row and the panel in the
          area the pill expands into (two portals, same component). */}
      {switcher?.trigger && switcher.panel && switcher.container && (
        <BoardSwitcher
          manager={switcher.manager}
          metaStore={switcher.metaStore}
          triggerSlot={switcher.trigger}
          panelSlot={switcher.panel}
          container={switcher.container}
        />
      )}

      {/* Avatar — rendered INSIDE the right pill, next to the theme button. It
          uses a portal because the pill is created via innerHTML by the board's
          imperative logic, while the menu (open/close) is React state. */}
      {status === 'authenticated' &&
        user &&
        avatarSlot &&
        createPortal(
          <>
            <span className="sep" aria-hidden="true" />
            <button
              className="avatar-btn"
              title={user.name || user.email}
              aria-label={`Account of ${user.name || user.email}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              ) : (
                initial
              )}
            </button>
            {menuOpen && (
              <>
                <div className="avatar-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="avatar-menu" role="menu">
                  <div className="who">
                    <div className="nm">{user.name}</div>
                    <div className="em">{user.email}</div>
                  </div>
                  <button role="menuitem" onClick={handleLogout}>
                    Sair
                  </button>
                </div>
              </>
            )}
          </>,
          avatarSlot,
        )}

      {/* Modal de login (Google) */}
      {modalOpen && (
        <div className="login-backdrop">
          <div className="login-modal">
            <button className="xbtn" title="Close" onClick={() => { setModalOpen(false); setDismissed(true); }}>
              ×
            </button>
            {/* Product mark, in SVG: no emoji (rendering varies per system). */}
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="login-mark"
            >
              <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
              <path d="M8 4v16M2.5 12h19" />
            </svg>
            <h2>Welcome to OmniBoard</h2>
            <p>Sign in to save your boards in the cloud and reach them from anywhere.</p>
            <button className="gbtn" onClick={handleGoogle} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              {busy ? 'Signing in…' : 'Continue with Google'}
            </button>
            <p className="offline">
              You can keep working offline — but your progress <b>will not be saved</b>.
            </p>
            {/* Required by Google's consent screen: privacy policy and terms
                visible before the user signs in. */}
            <p className="legal-links">
              By signing in you agree to the <a href="/terms">Terms</a> and the{' '}
              <a href="/privacy">Privacy policy</a>.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
