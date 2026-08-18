import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardElement, NoteElement } from '@omniboard/react';

// Note modal.
//
// The canvas is bad for typing paragraphs: small font, zoom in the way, no
// scrolling. So the card on the board is only the preview (title + excerpt) and
// the text lives here, in a large field. The element remains the source of truth
// — the modal writes into it, and the workspace save follows the normal flow.

/** Subset of the Board the modal uses (makes it testable without a canvas). */
export interface NoteBoardLike {
  getElement(id: string): BoardElement | undefined;
  updateElement(id: string, patch: Partial<BoardElement>, opts?: { record?: boolean }): void;
  removeElement(id: string, opts?: { record?: boolean }): void;
  on(type: 'elementActivate', listener: (e: unknown) => void): () => void;
}

interface Props {
  board: NoteBoardLike;
  /** Freshly created note: the modal opens blank and vanishes if nothing is written. */
  onClose?: () => void;
}

const Icon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
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
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
};

/** Stripe colors: they identify the note from afar, on the canvas card. */
const COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#64748b'];

interface OpenNote {
  id: string;
  title: string;
  text: string;
  color: string;
  /** Created just now: closing without content discards the card. */
  isNew: boolean;
}

export function BoardNoteModal({ board, onClose }: Props) {
  const [aberta, setAberta] = useState<OpenNote | null>(null);
  const openNoteRef = useRef<OpenNote | null>(null);
  openNoteRef.current = aberta;

  // The board notifies by event when the note is activated (double click, click
  // in navigation mode, or right after creating it).
  useEffect(() => {
    return board.on('elementActivate', (event) => {
      const e = event as { element?: BoardElement; reason?: string };
      const el = e.element;
      if (!el || el.type !== 'note') return;
      const note = el as NoteElement;
      setAberta({
        id: note.id,
        title: note.title ?? '',
        text: note.text ?? '',
        color: note.color ?? COLORS[0],
        isNew: e.reason === 'create',
      });
    });
  }, [board]);

  /** Writes into the element. `record` enables the undo step (only on close). */
  const write = useCallback(
    (a: OpenNote, record: boolean) => {
      board.updateElement(
        a.id,
        { title: a.title, text: a.text, color: a.color } as Partial<BoardElement>,
        { record },
      );
    },
    [board],
  );

  const close = useCallback(() => {
    const a = openNoteRef.current;
    setAberta(null);
    if (!a) return;
    // A note created and abandoned blank must not become an empty card on the
    // board.
    if (a.isNew && !a.title.trim() && !a.text.trim()) {
      board.removeElement(a.id, { record: false });
    } else {
      write(a, true);
    }
    onClose?.();
  }, [board, write, onClose]);

  // Saves while typing (with no undo step per keystroke) so it does not depend on
  // the user closing properly — reloading the page halfway does not lose the text.
  useEffect(() => {
    if (!aberta) return;
    const t = setTimeout(() => write(aberta, false), 400);
    return () => clearTimeout(t);
  }, [aberta, write]);

  // Closes (and saves) when the component unmounts, e.g. on a board switch.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => () => closeRef.current(), []);

  useEffect(() => {
    if (!aberta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [aberta, close]);

  if (!aberta) return null;

  const remove = () => {
    board.removeElement(aberta.id);
    setAberta(null);
    onClose?.();
  };

  return (
    <div className="note-backdrop" onPointerDown={close}>
      <div
        className="note-modal"
        role="dialog"
        aria-label="Note"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header>
          <span className="faixa" style={{ background: aberta.color }} aria-hidden="true" />
          <input
            className="titulo"
            value={aberta.title}
            placeholder="Note title"
            aria-label="Note title"
            autoFocus={!aberta.title}
            onChange={(e) => setAberta({ ...aberta, title: e.target.value })}
          />
          <div className="colors" role="group" aria-label="Note color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                style={{ background: c }}
                data-on={c === aberta.color || undefined}
                aria-label={`Cor ${c}`}
                onClick={() => setAberta({ ...aberta, color: c })}
              />
            ))}
          </div>
          <button type="button" className="danger" onClick={remove} title="Delete note" aria-label="Delete note">
            <Icon d={PATH.trash} />
          </button>
          <button type="button" onClick={close} title="Close" aria-label="Close">
            <Icon d={PATH.close} />
          </button>
        </header>

        <textarea
          className="body"
          value={aberta.text}
          placeholder="Write freely. The card on the board shows the first lines."
          aria-label="Note content"
          autoFocus={!!aberta.title}
          onChange={(e) => setAberta({ ...aberta, text: e.target.value })}
        />

        <footer>
          <span>{countWords(aberta.text)}</span>
          <span className="dica">Esc fecha e salva</span>
        </footer>
      </div>
    </div>
  );
}

/** Count label ("12 words"), useful on a long note. */
export function countWords(text: string): string {
  const n = text.trim() ? text.trim().split(/\s+/).length : 0;
  return n === 1 ? '1 word' : `${n} words`;
}
