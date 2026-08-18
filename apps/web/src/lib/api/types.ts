// API contract types (mirror go-single-starter).

// Response envelope: success merges the data; an error carries
// { success:false, error }.
export interface ApiErrorBody {
  success: false;
  error: string;
}

// The user always comes from a Google account: there are no password or email
// verification fields (Google only hands out profiles with a verified email).
export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  is_active: boolean;
  two_factor_enabled: boolean;
  last_login_at: string | null;
}

export interface AuthResponse {
  success: true;
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

export interface MeResponse {
  success: true;
  user: User;
}

// Cursor-based listing page. The item key varies per resource
// (e.g. "items"), which is why it is indexed.
export interface CursorPage {
  success: true;
  has_more: boolean;
  next_cursor: string;
  total?: number;
  [key: string]: unknown;
}
