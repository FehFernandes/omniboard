import { describe, it, expect } from 'vitest';
import { buildCursorPath, getNextCursor, flattenPages } from './use-cursor-query';
import type { CursorPage } from '../api/types';

describe('buildCursorPath', () => {
  it('monta limit/cursor/params ignorando vazios', () => {
    expect(buildCursorPath('/items', { limit: 20 })).toBe('/items?limit=20');
    expect(buildCursorPath('/items', { cursor: 'abc' })).toBe('/items?cursor=abc');
    expect(
      buildCursorPath('/items', { limit: 10, params: { status: 'active', q: '', n: undefined } }),
    ).toBe('/items?limit=10&status=active');
    expect(buildCursorPath('/items')).toBe('/items');
  });
});

describe('getNextCursor', () => {
  it('returns the cursor only when there is a next page', () => {
    expect(getNextCursor({ success: true, has_more: true, next_cursor: 'x' })).toBe('x');
    expect(getNextCursor({ success: true, has_more: false, next_cursor: 'x' })).toBeUndefined();
    expect(getNextCursor({ success: true, has_more: true, next_cursor: '' })).toBeUndefined();
  });
});

describe('flattenPages', () => {
  it('joins the items of every page by key', () => {
    const pages: CursorPage[] = [
      { success: true, has_more: true, next_cursor: 'a', items: [1, 2] },
      { success: true, has_more: false, next_cursor: '', items: [3] },
    ];
    expect(flattenPages<number>(pages, 'items')).toEqual([1, 2, 3]);
    expect(flattenPages<number>(undefined, 'items')).toEqual([]);
  });
});
