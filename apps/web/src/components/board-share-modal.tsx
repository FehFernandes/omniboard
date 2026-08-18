import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../lib/api/client';
import {
  createShare,
  listShares,
  revokeShare,
  shareUrl,
  type Share,
} from '../lib/boards/share';
import { reportError } from '../lib/telemetry/errors';

// Share modal.
//
// Two honesty rules the layout has to respect:
//   1. Say that whoever has the link sees the board, with no account. Hiding that
//      in a tooltip is the same as not saying it.
//   2. Revoking has to be visible next to the link, not buried in a settings
//      list.

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
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M4 12l5 5L20 6',
  link: 'M13 4h7v7M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
};

interface Props {
  client: ApiClient;
  /** Active board: it is the one the link is generated for. */
  boardId: string;
  boardName: string;
  openId: boolean;
  onClose: () => void;
  /** Visual feedback reusing the island's toast. */
  onWarn?: (msg: string) => void;
}

export function BoardShareModal({
  client,
  boardId,
  boardName,
  openId,
  onClose,
  onWarn,
}: Props) {
  const [share, setShare] = useState<Share | null>(null);
  const [loading, setCarregando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopiado] = useState(false);

  // On open, show the link that already exists (if any) instead of creating
  // another one.
  useEffect(() => {
    if (!openId) return;
    setError(null);
    setCopiado(false);
    let cancelled = false;
    setCarregando(true);
    listShares(client)
      .then((list) => {
        if (cancelled) return;
        setShare(list.find((s) => s.board_id === boardId) ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError('share.list', err);
        setError('Could not load the links.');
      })
      .finally(() => !cancelled && setCarregando(false));
    return () => {
      cancelled = true;
    };
  }, [openId, client, boardId]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [openId, onClose]);

  const create = useCallback(async () => {
    setCarregando(true);
    setError(null);
    try {
      setShare(await createShare(client, boardId, boardName));
    } catch (err) {
      reportError('share.create', err);
      setError('Could not create the link.');
    } finally {
      setCarregando(false);
    }
  }, [client, boardId, boardName]);

  const revoke = useCallback(async () => {
    if (!share) return;
    setCarregando(true);
    setError(null);
    try {
      await revokeShare(client, share.id);
      setShare(null);
      onWarn?.('Link desativado');
    } catch (err) {
      reportError('share.revoke', err);
      setError('Could not disable the link.');
    } finally {
      setCarregando(false);
    }
  }, [client, share, onWarn]);

  const copy = useCallback(async () => {
    if (!share) return;
    const url = shareUrl(share.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch (err) {
      // No clipboard permission (http, permission denied): the field stays
      // selectable, so the user copies it by hand.
      reportError('share.copy', err);
      onWarn?.('Copie o link manualmente');
    }
  }, [share, onWarn]);

  if (!openId) return null;

  return (
    <div className="share-backdrop" onPointerDown={onClose}>
      <div
        className="share-modal"
        role="dialog"
        aria-label="Compartilhar board"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header>
          <span className="ico" aria-hidden="true">
            <Icon d={PATH.link} />
          </span>
          <h3>Compartilhar “{boardName}”</h3>
          <button type="button" onClick={onClose} title="Close" aria-label="Close">
            <Icon d={PATH.close} />
          </button>
        </header>

        {share ? (
          <>
            <div className="field">
              <input
                readOnly
                value={shareUrl(share.token)}
                aria-label="Board link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" onClick={copy} aria-label="Copy link">
                <Icon d={copied ? PATH.check : PATH.copy} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="warning">
              Anyone with this link can see the board, <b>without an account</b>. The
              content is read-only: whoever opens it changes nothing.
            </p>
            <p className="stats">
              {share.views > 0
                ? `${share.views} ${share.views === 1 ? 'view' : 'views'} so far`
                : 'No views yet'}
            </p>
            <footer>
              <button type="button" className="revogar" onClick={revoke} disabled={loading}>
                Desativar link
              </button>
            </footer>
          </>
        ) : (
          <>
            <p className="warning">
              Creates a public read-only address for this board. Anyone with the link
              sees the content without an account — and you can disable it whenever you
              want.
            </p>
            <footer>
              <button type="button" className="create" onClick={create} disabled={loading}>
                {loading ? 'Generating…' : 'Create read-only link'}
              </button>
            </footer>
          </>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
