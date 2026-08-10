import { describe, it, expect, beforeEach } from 'vitest';
import { createLocalTokenStore, createMemoryTokenStore } from './token-store';

describe('memory token store', () => {
  it('set/get/clear', () => {
    const s = createMemoryTokenStore();
    expect(s.getAccess()).toBeNull();
    s.set({ access: 'a', refresh: 'r' });
    expect(s.getAccess()).toBe('a');
    expect(s.getRefresh()).toBe('r');
    s.clear();
    expect(s.getAccess()).toBeNull();
    expect(s.getRefresh()).toBeNull();
  });
});

describe('local token store', () => {
  beforeEach(() => localStorage.clear());

  it('persiste no localStorage sob o prefixo', () => {
    const s = createLocalTokenStore('mt');
    s.set({ access: 'a', refresh: 'r' });
    expect(localStorage.getItem('mt.access')).toBe('a');
    expect(localStorage.getItem('mt.refresh')).toBe('r');
    expect(s.getRefresh()).toBe('r');
    s.clear();
    expect(localStorage.getItem('mt.access')).toBeNull();
  });
});
