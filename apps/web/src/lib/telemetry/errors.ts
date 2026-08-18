// Client-side error tracking.
//
// It exists because `catch {}` erases the evidence: when the user says "my board
// is gone", there is nothing left to investigate. Here every handled error goes
// through a single point, with a context ("workspace.save", "upload.image"), and
// stays in memory for inspection.
//
// It deliberately does not bind to Sentry/LogRocket: it is a hook. Once you pick
// a service, register a `reporter` in the bootstrap (main.tsx) and nothing else
// changes.

export interface ReportedError {
  /** Where it happened, e.g. "workspace.save". */
  context: string;
  message: string;
  /** HTTP status when the error comes from the API. */
  status?: number;
  at: number;
  error?: unknown;
}

type Reporter = (e: ReportedError) => void;

const MAX_HISTORY = 50;
const history: ReportedError[] = [];
const reporters = new Set<Reporter>();

/** Extracts a readable message from anything that lands in a catch. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as { error?: unknown; message?: unknown };
    if (typeof e.error === 'string') return e.error;
    if (typeof e.message === 'string') return e.message;
  }
  return 'unknown error';
}

/**
 * Records a handled error. Returns the record (useful for logging/tests).
 *
 * Never throws: an error inside the error tracking must not break the flow.
 */
export function reportError(context: string, err: unknown): ReportedError {
  const entry: ReportedError = {
    context,
    message: errorMessage(err),
    status: (err as { status?: number } | null)?.status,
    at: Date.now(),
    error: err,
  };

  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();

  if (import.meta.env?.DEV) {
    console.error(`[omniboard:${context}]`, err);
  }
  for (const r of reporters) {
    try {
      r(entry);
    } catch {
      /* a broken reporter must not turn into a cascading error */
    }
  }
  return entry;
}

/** Hooks up an external sink (Sentry etc.). Returns the function to unhook. */
export function onErrorReported(reporter: Reporter): () => void {
  reporters.add(reporter);
  return () => reporters.delete(reporter);
}

/** Latest errors, from oldest to newest (for support/debugging). */
export function recentErrors(): ReportedError[] {
  return [...history];
}

/** Clears the history (used in the tests). */
export function clearErrors(): void {
  history.length = 0;
}
