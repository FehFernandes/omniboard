// Token storage. Two implementations: localStorage (browser) and in-memory
// (tests/SSR). The client depends only on the TokenStore interface.

export interface Tokens {
  access: string;
  refresh: string;
}

export interface TokenStore {
  getAccess(): string | null;
  getRefresh(): string | null;
  set(tokens: Tokens): void;
  clear(): void;
}

// createLocalTokenStore persists to localStorage under a prefix.
export function createLocalTokenStore(prefix = 'mt'): TokenStore {
  const aKey = `${prefix}.access`;
  const rKey = `${prefix}.refresh`;
  return {
    getAccess: () => localStorage.getItem(aKey),
    getRefresh: () => localStorage.getItem(rKey),
    set: ({ access, refresh }) => {
      localStorage.setItem(aKey, access);
      localStorage.setItem(rKey, refresh);
    },
    clear: () => {
      localStorage.removeItem(aKey);
      localStorage.removeItem(rKey);
    },
  };
}

// createMemoryTokenStore keeps them in memory (useful in tests and in
// environments without a DOM).
export function createMemoryTokenStore(initial?: Partial<Tokens>): TokenStore {
  let access: string | null = initial?.access ?? null;
  let refresh: string | null = initial?.refresh ?? null;
  return {
    getAccess: () => access,
    getRefresh: () => refresh,
    set: (t) => {
      access = t.access;
      refresh = t.refresh;
    },
    clear: () => {
      access = null;
      refresh = null;
    },
  };
}
