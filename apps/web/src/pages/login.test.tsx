import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './login';
import { AuthProvider } from '../lib/auth/auth-context';
import { createQueryClient } from '../lib/query/query-client';

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  it('offers the Google login as a top-level navigation link', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /continue with google/i });
    // It has to be an <a> pointing at the API: the OAuth flow requires leaving
    // the SPA.
    expect(link.getAttribute('href')).toMatch(/\/auth\/google$/);
  });

  // Requirement regression: there is no other way to log in.
  it('does not expose email/password fields or a signup link', () => {
    renderPage();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /sign in|create account/i })).toBeNull();
    expect(screen.queryByText(/forgot my password/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
  });
});
