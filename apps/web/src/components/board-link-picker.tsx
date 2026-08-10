import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardElement, LinkElement } from '@omniboard/react';

// Shortcut to another board.
//
// Two responsibilities, one in the core and the other here: the canvas keeps an
// opaque `targetId` and reports that the shortcut was activated; whoever knows
// that it is a board — and how to switch boards — is the application. This
// component handles both ends: picking the target (when the shortcut does not
// have one yet) and navigating (when it does).

/** Subset of the BoardManager used here. */
export interface LinkManagerLike {
  list(): { id: string; name: string }[];
  getActiveId(): string;
  switch(id: string): void;
}

/** Subset of the Board used here. */
export interface LinkBoardLike {
  getElement(id: string): BoardElement | undefined;
  updateElement(id: string, patch: Partial<BoardElement>, opts?: { record?: boolean }): void;
  removeElement(id: string, opts?: { record?: boolean }): void;
  on(type: 'elementActivate', listener: (e: unknown) => void): () => void;
}

interface Props {
  board: LinkBoardLike;
  manager: LinkManagerLike;
  /** Called on navigation, so the UI can give feedback (toast). */
  onNavigate?: (name: string) => void;
  /** Called when the target points at a board that no longer exists. */
  onMissing?: () => void;
}

interface TargetChoice {
  id: string;
  /** Current name of the target, when it already exists. */
  current?: string;
}

export function BoardLinkPicker({ board, manager, onNavigate, onMissing }: Props) {
  const [choice, setEscolha] = useState<TargetChoice | null>(null);
  const [isNew, setNova] = useState(false);
  const isNewRef = useRef(false);
  isNewRef.current = isNew;

  const apply = useCallback(
    (elId: string, targetId: string, name: string) => {
      board.updateElement(elId, {
        targetId: targetId,
        label: name,
        subtitle: 'board',
      } as Partial<BoardElement>);
    },
    [board],
  );

  useEffect(() => {
    return board.on('elementActivate', (event) => {
      const e = event as { element?: BoardElement; reason?: string };
      const el = e.element;
      if (!el || el.type !== 'link') return;
      const link = el as LinkElement;
      const targets = manager.list();
      const target = link.targetId ? targets.find((d) => d.id === link.targetId) : undefined;

      // Without a target (or with a deleted one): open the picker.
      if (!target) {
        if (link.targetId) onMissing?.();
        setNova(e.reason === 'create');
        setEscolha({ id: link.id });
        return;
      }

      // With a target: navigate. A shortcut that opens a picker on every click
      // would not be a shortcut.
      if (target.id === manager.getActiveId()) {
        onNavigate?.(`You are already on ${target.name}`);
        return;
      }
      // The name may have changed since the shortcut was created.
      if (link.label !== target.name) apply(link.id, target.id, target.name);
      manager.switch(target.id);
      onNavigate?.(target.name);
    });
  }, [board, manager, apply, onNavigate, onMissing]);

  const close = useCallback(
    (chosen?: { id: string; name: string }) => {
      const current = choice;
      setEscolha(null);
      if (!current) return;
      if (chosen) {
        apply(current.id, chosen.id, chosen.name);
        return;
      }
      // A shortcut created just now and abandoned without a target does not stay
      // on the board.
      if (isNewRef.current) board.removeElement(current.id, { record: false });
    },
    [choice, apply, board],
  );

  useEffect(() => {
    if (!choice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [choice, close]);

  if (!choice) return null;

  const activeId = manager.getActiveId();
  const targets = manager.list().filter((d) => d.id !== activeId);

  return (
    <div className="link-backdrop" onPointerDown={() => close()}>
      <div
        className="link-modal"
        role="dialog"
        aria-label="Choose the target board"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h3>Go to which board?</h3>
        {targets.length === 0 ? (
          <p className="empty">
            This is your only board. Create another one in the boards menu to point a
            shortcut at it.
          </p>
        ) : (
          <ul>
            {targets.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => close(d)}>
                  {d.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <footer>
          <button type="button" className="cancelar" onClick={() => close()}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
