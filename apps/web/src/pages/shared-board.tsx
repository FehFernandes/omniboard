import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Board } from '@omniboard/react';
import { API_URL } from '../lib/api/config';
import { fetchPublicBoard, type SharedBoard } from '../lib/boards/share';
import { reportError } from '../lib/telemetry/errors';
import './shared-board.css';

// Public page for a shared board (/b/:token).
//
// Genuinely read-only: the board starts in navigation mode (locked), with no
// tools, no context menu and no persistence. Nothing here writes — neither to the
// server nor to the visitor's localStorage.
//
// It also avoids ApiClient: this route is anonymous, and sending the auth header
// of whoever happens to be signed in would only add risk with no benefit.

export function SharedBoardPage() {
  const { token = '' } = useParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<Board | null>(null);
  const [board, setBoard] = useState<SharedBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1) Fetch the content.
  useEffect(() => {
    let cancelled = false;
    fetchPublicBoard(token, API_URL)
      .then((b) => !cancelled && setBoard(b))
      .catch((err) => {
        if (cancelled) return;
        reportError('share.public', err);
        setError(err instanceof Error ? err.message : 'Could not open this board.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 2) Mount the canvas once the content arrives.
  useEffect(() => {
    if (!board || !hostRef.current) return;
    const b = new Board(hostRef.current, {
      grid: true,
      theme: 'light',
      // No editing overlays: there is nothing to edit here.
      contextMenu: false,
      selectionToolbar: false,
    });
    boardRef.current = b;
    try {
      b.loadSnapshot(board.snapshot as never);
      b.zoomToFit();
    } catch (err) {
      reportError('share.render', err);
      setError('The content of this board could not be read.');
    }
    // Navigation mode: pan, zoom and interaction with tasks/embeds, changing
    // nothing.
    b.setLocked(true);
    return () => {
      b.destroy();
      boardRef.current = null;
    };
  }, [board]);

  if (error) {
    return (
      <div className="shared-error">
        <h1>Board unavailable</h1>
        <p>{error}</p>
        <Link to="/">Open OmniBoard</Link>
      </div>
    );
  }

  return (
    <div className="shared-page">
      <header className="shared-bar">
        <span className="name">{board?.name ?? 'Loading…'}</span>
        <span className="badge">read-only</span>
        <div className="actions">
          <button type="button" onClick={() => boardRef.current?.zoomToFit()}>
            Fit to screen
          </button>
          <Link className="cta" to="/">
            Create my own board
          </Link>
        </div>
      </header>

      <div className="shared-canvas" ref={hostRef} />

      {!board && <p className="shared-loading">Loading the board…</p>}
    </div>
  );
}
