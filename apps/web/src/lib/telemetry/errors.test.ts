import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  onErrorReported,
  recentErrors,
  clearErrors,
  errorMessage,
  reportError,
} from './errors';
import { ApiError } from '../api/client';

describe('error tracking', () => {
  beforeEach(() => clearErrors());

  it('stores context and message instead of swallowing the error', () => {
    reportError('workspace.save', new Error('rede caiu'));
    const [e] = recentErrors();
    expect(e.context).toBe('workspace.save');
    expect(e.message).toBe('rede caiu');
    expect(e.at).toBeGreaterThan(0);
  });

  it('extracts the status from an API error (useful for triage)', () => {
    reportError('upload.image', new ApiError(413, 'grande demais'));
    const [e] = recentErrors();
    expect(e.status).toBe(413);
    expect(e.message).toBe('grande demais');
  });

  it('reads a message out of anything that lands in a catch', () => {
    expect(errorMessage(new Error('x'))).toBe('x');
    expect(errorMessage('loose text')).toBe('loose text');
    expect(errorMessage({ error: 'from the response body' })).toBe('from the response body');
    expect(errorMessage({ message: 'de objeto' })).toBe('de objeto');
    expect(errorMessage(null)).toBe('unknown error');
    expect(errorMessage(42)).toBe('unknown error');
  });

  it('forwards to the registered external sink (Sentry hook)', () => {
    const reporter = vi.fn();
    const off = onErrorReported(reporter);

    reportError('a', new Error('um'));
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0][0].context).toBe('a');

    off();
    reportError('b', new Error('dois'));
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  // Tracking an error must not become one more source of errors.
  it('a reporter that throws does not break the flow', () => {
    onErrorReported(() => {
      throw new Error('reporter quebrado');
    });
    expect(() => reportError('x', new Error('original'))).not.toThrow();
    expect(recentErrors()).toHaveLength(1);
  });

  it('history is bounded (does not turn into a memory leak)', () => {
    for (let i = 0; i < 70; i++) reportError('loop', new Error(`e${i}`));
    const list = recentErrors();
    expect(list).toHaveLength(50);
    // Keeps the most recent ones.
    expect(list[list.length - 1].message).toBe('e69');
  });

  it('returns the record to the caller', () => {
    const r = reportError('ctx', new Error('m'));
    expect(r.context).toBe('ctx');
    expect(r.error).toBeInstanceOf(Error);
  });
});
