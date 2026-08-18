// Legal pages: privacy policy and terms of use.
//
// Not decoration: Google's consent screen requires public privacy and terms URLs
// for the app to leave "testing" mode (capped at 100 accounts). Without them the
// verification does not move forward — and that tends to block a launch for
// weeks when it is left for last.
//
// The text describes what this code ACTUALLY does. If the behavior changes (a
// new piece of data collected, a new third party), the text changes with it.
import { Link } from 'react-router-dom';
import './legal.css';

const UPDATED_AT = 'July 30, 2026';

/** Shared shell: both pages are readable documents, independent of the board. */
function LegalDocument({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="legal-page">
      <header>
        <Link to="/" className="back">
          ← Back to the board
        </Link>
        <h1>{title}</h1>
        <p className="updated">Updated on {UPDATED_AT}</p>
      </header>
      <main>{children}</main>
      <footer>
        <Link to="/privacy">Privacy</Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms">Terms</Link>
      </footer>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalDocument title="Privacy policy">
      <p>
        OmniBoard is an infinite whiteboard. This policy describes, in plain
        language, what data the service keeps, why, and what you can do about it.
      </p>

      <h2>Data we collect</h2>
      <p>
        <strong>Account.</strong> When you sign in with Google we receive and store
        your name, email, profile picture and Google account identifier. We have no
        access to your Google password and we do not ask for permission to read
        your email, files or contacts.
      </p>
      <p>
        <strong>Board content.</strong> Everything you draw, write, comment or
        upload (images included) is stored so you can find your work again. Images
        live in a storage bucket under random, unlisted addresses; anyone holding
        the exact address of an image can see it, so avoid uploading confidential
        material.
      </p>
      <p>
        <strong>Technical records.</strong> We keep access dates, active sessions
        and an audit trail of sensitive actions on the account itself (sign in,
        sign out, terminating sessions). It exists for security and support.
      </p>
      <p>
        <strong>Use without an account.</strong> Without signing in, your boards
        stay only in your browser's local storage. Nothing is sent to the server —
        and nothing is recoverable if you clear the browser.
      </p>

      <h2>What we do not do</h2>
      <p>
        We do not sell your data. We do not use the content of your boards to train
        models. We show no advertising and we do not track you across other sites.
      </p>

      <h2>Third parties that process data</h2>
      <ul>
        <li>
          <strong>Google</strong> — authentication (sign-in). It receives only what
          is necessary to authenticate you.
        </li>
        <li>
          <strong>Cloudflare R2</strong> — storage for uploaded images.
        </li>
        <li>
          <strong>Stripe</strong> — billing, if you subscribe to a paid plan. Card
          details go straight to Stripe; we neither receive nor store them.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        For as long as your account exists. When you request account deletion we
        erase the record and its associated content; residual backups expire within
        30 days.
      </p>

      <h2>Your rights</h2>
      <p>
        You can export your boards as JSON from the application menu at any time,
        revoke active sessions on the account page, and request complete deletion
        of your data. For deletion or questions, use the contact below.
      </p>

      <h2>Security</h2>
      <p>
        Access is authenticated by token and all traffic is encrypted in transit.
        Every request is scoped to the owner of the data. Even so, no system is
        infallible: if we identify an incident affecting your data, we will tell
        you.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy, export or deletion:{' '}
        <a href="mailto:contato@omniboard.app">contato@omniboard.app</a>.
      </p>
    </LegalDocument>
  );
}

export function TermsPage() {
  return (
    <LegalDocument title="Terms of use">
      <h2>The service</h2>
      <p>
        OmniBoard provides an infinite whiteboard for drawing, diagrams and notes.
        You can use it without an account (with the data only in your browser) or
        sign in with Google to save it in the cloud.
      </p>

      <h2>Your account</h2>
      <p>
        You are responsible for access to your Google account. By signing in you
        confirm that you are at least 13 years old and that your information is
        truthful.
      </p>

      <h2>Your content is yours</h2>
      <p>
        You keep all rights over what you create. You grant us only the technical
        permission needed to store that content and show it back to you. We may
        remove content that is illegal or that violates these terms.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Do not use the service for illegal content, to violate the rights of
        others, to distribute malware, or to overload the infrastructure in an
        automated way. Do not attempt to access data belonging to other accounts.
      </p>

      <h2>Plans and billing</h2>
      <p>
        There is a free plan. Paid plans are charged by Stripe on a recurring basis
        and can be cancelled at any time, with access kept until the end of the
        period already paid for.
      </p>

      <h2>Availability and warranties</h2>
      <p>
        The service is provided "as is", with no guarantee of uninterrupted
        availability. Keep copies of anything critical — JSON export is in the
        application menu. To the extent permitted by law, we are not liable for
        lost profits or data loss arising from use of the service.
      </p>

      <h2>Termination</h2>
      <p>
        You can stop using the service and request account deletion whenever you
        want. We may suspend accounts that violate these terms, with notice
        whenever possible.
      </p>

      <h2>Changes</h2>
      <p>
        If these terms change in a meaningful way, we will announce it in the
        application before the change takes effect. Continuing to use it after the
        notice means agreeing to the new version.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:contato@omniboard.app">contato@omniboard.app</a>
      </p>
    </LegalDocument>
  );
}
