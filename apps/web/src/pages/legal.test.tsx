import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App } from '../App';
import { PrivacyPage, TermsPage } from './legal';

/**
 * These pages exist for Google's OAuth verification: the form hits the URLs
 * directly, without a session. So they need to render on their own — no auth
 * provider, no query client, no canvas.
 */
function open(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('legal pages', () => {
  it('privacy opens without authentication and without the board', () => {
    open('/privacy');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/privacy/i);
    cleanup();
  });

  it('terms opens without authentication', () => {
    open('/terms');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/terms/i);
    cleanup();
  });

  // What Google demands at verification: stating which data is collected, who
  // it is shared with and how to request deletion.
  it('privacy covers collected data, third parties and deletion', () => {
    open('/privacy');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Google/);
    expect(text).toMatch(/Cloudflare R2/);
    expect(text).toMatch(/Stripe/);
    expect(text).toMatch(/deletion/i);
    expect(text).toMatch(/do not sell/i);
    // A contact address is mandatory for data-subject requests.
    expect(document.querySelector('a[href^="mailto:"]')).toBeTruthy();
    cleanup();
  });

  it('warns that an image in a public bucket is reachable by whoever has the URL', () => {
    open('/privacy');
    expect(document.body.textContent).toMatch(/anyone holding the exact address/i);
    cleanup();
  });

  it('terms cover content ownership, acceptable use and billing', () => {
    open('/terms');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/keep all rights/i);
    expect(text).toMatch(/acceptable use/i);
    expect(text).toMatch(/Stripe/);
    cleanup();
  });

  it('each one links to the other (Google asks for both links)', () => {
    open('/privacy');
    expect(screen.getByRole('link', { name: /terms/i })).toBeTruthy();
    cleanup();
    open('/terms');
    expect(screen.getByRole('link', { name: /privacy/i })).toBeTruthy();
    cleanup();
  });

  it('the Portuguese routes redirect to the English ones', () => {
    render(
      <MemoryRouter initialEntries={['/privacidade']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/privacy/i);
    cleanup();

    render(
      <MemoryRouter initialEntries={['/termos']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/terms/i);
    cleanup();
  });
});
