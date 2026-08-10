import { QueryClient } from '@tanstack/react-query';

// Default QueryClient. Tune staleTime/retry to the needs of the app.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
