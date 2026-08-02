import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/cabinet.js';
import { clearLinkToken, openPlaidLink, readLinkToken, type PlaidHandler } from '../lib/plaidLink.js';
import './money.css';

/**
 * /plaid/oauth — where an OAuth bank drops the browser back.
 *
 * Banks like Bank of America don't do the login inside Plaid's iframe: Link
 * navigates the whole tab to the bank, and the bank navigates it back here
 * with an `oauth_state_id` in the query string. The app was torn down and
 * rebuilt in between, so React state is gone — the link token has to come
 * back off localStorage, and Link has to be re-created with that SAME token
 * plus `receivedRedirectUri: window.location.href` for it to recognise the
 * session it's resuming.
 *
 * Bare on purpose: no rail, no shell. This page exists for a few seconds
 * between two other pages and should look like a doorway, not a destination.
 */

type Phase = 'resuming' | 'exchanging' | 'missing' | 'failed';

const MISSING_COPY =
  "I don't have the link token this redirect belongs to — it's cleared once a link finishes, and it doesn't survive a different browser or a cleared cache. Nothing was linked and nothing was broken; start the connection again from Money.";

export function PlaidOAuth() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('resuming');
  const [error, setError] = useState<string | null>(null);
  const handlerRef = useRef<PlaidHandler | null>(null);
  // Strict-mode double-invoke would otherwise open Link twice and burn the
  // one-shot oauth_state_id on the first of them.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = readLinkToken();
    if (!token) {
      setPhase('missing');
      return;
    }

    openPlaidLink({
      token,
      receivedRedirectUri: window.location.href,
      onSuccess: (publicToken) => {
        clearLinkToken();
        setPhase('exchanging');
        api
          .plaidExchange(publicToken)
          .then(() => navigate('/money'))
          .catch((e: unknown) => {
            setError(e instanceof Error && e.message ? e.message : "The bank connected, but I couldn't seal the token.");
            setPhase('failed');
          });
      },
      onExit: (err) => {
        clearLinkToken();
        if (err) {
          setError(err.display_message ?? err.error_message ?? `Link closed: ${err.error_code ?? 'unknown error'}`);
          setPhase('failed');
        } else {
          // Closed without an error — Ben backed out. Nothing to report.
          navigate('/money');
        }
      },
    })
      .then((h) => {
        handlerRef.current = h;
      })
      .catch((e: unknown) => {
        clearLinkToken();
        setError(e instanceof Error && e.message ? e.message : "Couldn't reopen Plaid Link.");
        setPhase('failed');
      });

    return () => {
      handlerRef.current?.destroy();
      handlerRef.current = null;
    };
  }, [navigate]);

  return (
    <div className="plaid-oauth">
      <span className="wordmark">CABINET</span>
      {phase === 'resuming' && <p className="plaid-oauth-line">Picking the connection back up where your bank left it…</p>}
      {phase === 'exchanging' && <p className="plaid-oauth-line">Connected. Sealing the token and starting the first sync…</p>}
      {phase === 'missing' && <p className="plaid-oauth-line bad">{MISSING_COPY}</p>}
      {phase === 'failed' && <p className="plaid-oauth-line bad">{error}</p>}
      {(phase === 'missing' || phase === 'failed') && (
        <Link className="plaid-oauth-link" to="/money">
          Back to Money
        </Link>
      )}
    </div>
  );
}
