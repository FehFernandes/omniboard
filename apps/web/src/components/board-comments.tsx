import { useCallback, useEffect, useRef, useState } from 'react';
import { CommentStore, initial, relativeTime, type BoardComment } from '../lib/boards/comments';

// Comment layer on top of the canvas.
//
// The pins are DOM (not canvas) because they need to take clicks, focus and hold
// a popover with editable text — things the canvas does not give for free. Their
// position comes from WORLD coordinates converted on every camera change, so the
// pin follows pan and zoom without scaling in size.

/** Subset of the Board the overlay uses (makes it testable without the canvas). */
export interface CommentBoardLike {
  camera: {
    worldToScreen(x: number, y: number): { x: number; y: number };
    screenToWorld(x: number, y: number): { x: number; y: number };
  };
  on(type: 'cameraChange', listener: () => void): () => void;
}

interface Props {
  board: CommentBoardLike;
  store: CommentStore;
  /** Active board: comments are per board. */
  boardId: string;
  /** Name shown as the author. */
  author: string;
  /** Comment mode on: clicking the canvas creates a pin. */
  active: boolean;
  /** Request to leave comment mode (after creating a pin, for example). */
  onDone: () => void;
}

const Icon = ({ d, filled }: { d: string; filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const PATH = {
  check: 'M4 12l5 5L20 6',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  close: 'M6 6l12 12M18 6L6 18',
  send: 'M4 12h14M12 6l6 6-6 6',
  // Speech bubble: identifies the pin without depending on an emoji.
  bubble: 'M20 14a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z',
};

export function BoardComments({ board, store, boardId, author, active, onDone }: Props) {
  const [comments, setComentarios] = useState<BoardComment[]>(() => store.list(boardId));
  const [openId, setAberto] = useState<string | null>(null);
  const [draft, setRascunho] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  /** Pin under the mouse: shows the preview without having to open the thread. */
  const [hoveredId, setPairado] = useState<string | null>(null);
  /** Freshly created pin, still without text: the popover opens in writing mode. */
  const createdRef = useRef<string | null>(null);
  // Tick only to force repositioning when the camera changes.
  const [, setTick] = useState(0);

  // Mirrors of the state so the closing routine can read the current value
  // without entering the effects' dependencies (the commit also runs on unmount).
  const draftRef = useRef('');
  draftRef.current = draft;
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

  useEffect(() => {
    const off = store.subscribe(() => setComentarios([...store.list(boardId)]));
    setComentarios([...store.list(boardId)]);
    return off;
  }, [store, boardId]);

  useEffect(() => board.on('cameraChange', () => setTick((t) => t + 1)), [board]);

  // While comment mode is on, the next click on the canvas creates a pin. We
  // listen in the capture phase to act before the board's tools.
  useEffect(() => {
    if (!active) return;
    const canvas = document.querySelector('#board canvas');
    if (!canvas) return;
    const onDown = (e: Event) => {
      const me = e as MouseEvent;
      e.preventDefault();
      e.stopPropagation();
      const rect = (canvas as HTMLElement).getBoundingClientRect();
      const world = board.camera.screenToWorld(me.clientX - rect.left, me.clientY - rect.top);
      const created = store.add(boardId, { x: world.x, y: world.y, text: '', author });
      createdRef.current = created.id;
      setAberto(created.id);
      setRascunho('');
      onDone();
    };
    canvas.addEventListener('pointerdown', onDown, { capture: true });
    return () => canvas.removeEventListener('pointerdown', onDown, { capture: true } as never);
  }, [active, board, store, boardId, author, onDone]);

  /**
   * Closes the popover **saving** whatever is written.
   *
   * The draft used to be saved only on submit: closing with Esc, with the X, by
   * clicking the pin or by switching boards erased the new pin and the text with
   * it. Losing what the user typed is worse than leaving one comment too many, so
   * closing commits; only a genuinely empty pin is discarded.
   */
  const close = useCallback(() => {
    const id = openIdRef.current;
    const text = draftRef.current.trim();
    if (id) {
      const c = store.list(boardId).find((x) => x.id === id);
      if (c) {
        if (text) {
          if (c.text.trim()) store.addReply(boardId, c.id, text, author);
          else store.update(boardId, c.id, { text: text });
        } else if (!c.text.trim()) {
          // A pin created and abandoned without text must not become litter on
          // the board.
          store.remove(boardId, c.id);
        }
      }
    }
    createdRef.current = null;
    setAberto(null);
    setRascunho('');
  }, [store, boardId, author]);

  // The commit also has to run on unmount (board switch, logout): without it the
  // open draft would be lost. A ref keeps the effect from re-running.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => () => closeRef.current(), []);

  // Escape closes the open popover.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, close]);

  // A click outside closes it (and saves). Without this the popover stayed open
  // indefinitely and the text was only saved on submit.
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.comment-anchor')) return;
      close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openId, close]);

  const send = (c: BoardComment) => {
    const text = draft.trim();
    if (!text) return;
    if (!c.text.trim()) {
      store.update(boardId, c.id, { text: text });
      createdRef.current = null;
    } else {
      store.addReply(boardId, c.id, text, author);
    }
    setRascunho('');
  };

  const visible = comments.filter((c) => showResolved || !c.resolved);
  const resolvedCount = comments.filter((c) => c.resolved).length;

  const screen = (c: BoardComment) => board.camera.worldToScreen(c.x, c.y);

  return (
    <div className="comments-layer" data-active={active || undefined}>
      {active && (
        <p className="comments-hint" role="status">
          Click the board to comment · Esc to leave
        </p>
      )}

      {resolvedCount > 0 && (
        <button
          type="button"
          className="comments-toggle-resolved"
          onClick={() => setShowResolved((v) => !v)}
        >
          {showResolved ? 'Hide' : 'Show'} resolved ({resolvedCount})
        </button>
      )}

      {visible.map((c) => {
        const p = screen(c);
        const replies = c.replies?.length ?? 0;
        const isOpen = openId === c.id;
        // Preview on hover: reading a comment should not require a click.
        const peeking = hoveredId === c.id && !isOpen && !!c.text.trim();
        return (
          <div
            key={c.id}
            className="comment-anchor"
            style={{ left: p.x, top: p.y }}
            onMouseEnter={() => setPairado(c.id)}
            onMouseLeave={() => setPairado((current) => (current === c.id ? null : current))}
          >
            <button
              type="button"
              className="comment-pin"
              data-resolved={c.resolved || undefined}
              data-open={isOpen || undefined}
              onClick={() => (isOpen ? close() : (setAberto(c.id), setRascunho('')))}
              aria-label={`Comment by ${c.author}: ${c.text || 'no text'}`}
            >
              {/* Author initial: identifies who spoke without taking up space. */}
              <span className="ini" aria-hidden="true">
                {initial(c.author)}
              </span>
              {c.resolved && (
                <span className="mark" aria-hidden="true">
                  <Icon d={PATH.check} />
                </span>
              )}
              {replies > 0 && !c.resolved && (
                <span className="badge" aria-hidden="true">
                  {replies + 1}
                </span>
              )}
            </button>

            {peeking && (
              <div className="comment-peek" aria-hidden="true">
                <div className="top">
                  <span className="who">{c.author}</span>
                  <span className="when">{relativeTime(c.createdAt)}</span>
                </div>
                <p>{c.text}</p>
                {replies > 0 && (
                  <span className="mais">
                    {replies === 1 ? '1 reply' : `${replies} replies`}
                  </span>
                )}
              </div>
            )}

            {isOpen && (
              <div className="comment-thread" role="dialog" aria-label="Comment">
                <header>
                  <span className="avatar" aria-hidden="true">
                    {initial(c.author)}
                  </span>
                  <span className="quem">
                    <span className="who">{c.author}</span>
                    <span className="when">{relativeTime(c.createdAt)}</span>
                  </span>
                  <span className="acoes">
                    <button
                      type="button"
                      onClick={() => store.toggleResolved(boardId, c.id)}
                      title={c.resolved ? 'Reopen' : 'Mark as resolved'}
                      aria-label={c.resolved ? 'Reopen' : 'Mark as resolved'}
                      data-on={c.resolved || undefined}
                    >
                      <Icon d={PATH.check} />
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        store.remove(boardId, c.id);
                        createdRef.current = null;
                        setAberto(null);
                      }}
                      title="Delete comment"
                      aria-label="Delete comment"
                    >
                      <Icon d={PATH.trash} />
                    </button>
                    <button type="button" onClick={close} title="Close" aria-label="Close">
                      <Icon d={PATH.close} />
                    </button>
                  </span>
                </header>

                <div className="conversa">
                  {c.text.trim() && <p className="body">{c.text}</p>}

                  {(c.replies ?? []).map((r) => (
                    <div key={r.id} className="reply">
                      <span className="avatar" aria-hidden="true">
                        {initial(r.author)}
                      </span>
                      <div className="conteudo">
                        <span className="top">
                          <span className="who">{r.author}</span>
                          <span className="when">{relativeTime(r.createdAt)}</span>
                        </span>
                        <p>{r.text}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <form
                  className="compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(c);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setRascunho(e.target.value)}
                    placeholder={c.text.trim() ? 'Reply…' : 'Write a comment…'}
                    aria-label={c.text.trim() ? 'Reply' : 'Write a comment'}
                  />
                  <button type="submit" title="Send" aria-label="Send" disabled={!draft.trim()}>
                    <Icon d={PATH.send} />
                  </button>
                </form>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
