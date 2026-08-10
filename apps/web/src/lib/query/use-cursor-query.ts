import { useInfiniteQuery } from '@tanstack/react-query';
import type { ApiClient } from '../api/client';
import type { CursorPage } from '../api/types';

export type QueryParam = string | number | boolean | undefined | null;

// buildCursorPath builds the path with limit/cursor + extra filters. Pure
// function.
export function buildCursorPath(
  path: string,
  opts: { limit?: number; cursor?: string; params?: Record<string, QueryParam> } = {},
): string {
  const sp = new URLSearchParams();
  if (opts.limit) sp.set('limit', String(opts.limit));
  if (opts.cursor) sp.set('cursor', opts.cursor);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

// getNextCursor returns the cursor of the next page, or undefined when there is
// none left. Pure.
export function getNextCursor(page: CursorPage): string | undefined {
  return page.has_more && page.next_cursor ? page.next_cursor : undefined;
}

// flattenPages joins the items of every page, extracting them by the resource
// key (e.g. "items"). Pure function.
export function flattenPages<T>(pages: CursorPage[] | undefined, dataKey: string): T[] {
  if (!pages) return [];
  return pages.flatMap((p) => (p[dataKey] as T[] | undefined) ?? []);
}

export interface UseCursorQueryOptions {
  limit?: number;
  params?: Record<string, QueryParam>;
}

// useCursorQuery wraps useInfiniteQuery for the has_more/next_cursor pattern.
// `dataKey` is the key of the items in the response (e.g. "items", "vehicles").
export function useCursorQuery(
  client: ApiClient,
  key: readonly unknown[],
  path: string,
  opts: UseCursorQueryOptions = {},
) {
  return useInfiniteQuery({
    queryKey: [...key, opts.params ?? {}, opts.limit ?? null] as const,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      client.get<CursorPage>(
        buildCursorPath(path, { limit: opts.limit, cursor: pageParam as string, params: opts.params }),
      ),
    getNextPageParam: (lastPage) => getNextCursor(lastPage),
  });
}
