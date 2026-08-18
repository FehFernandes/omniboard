// API base URL, without a trailing slash. Shared by the ApiClient and by the
// OAuth flow (which has to build a navigation href, outside the ApiClient).
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api').replace(
  /\/$/,
  '',
);
