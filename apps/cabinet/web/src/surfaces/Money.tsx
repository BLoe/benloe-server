import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type {
  CategorySpend, FinancialAccount, Holding, MoneyTransaction, NetWorth, PlaidItemStatus, PlaidItemSummary,
  PlaidStatus, SyncReport, InstrumentSpec,
} from '../lib/cabinet.js';
import { Instrument, SectionLabel } from '../components/instruments/index.js';
import { ConfirmDialog } from '../components/shell/index.js';
import { clearLinkToken, openPlaidLink, stashLinkToken, type PlaidHandler } from '../lib/plaidLink.js';
import './money.css';

/**
 * MONEY surface — the books.
 *
 * Two rules shape everything below, because getting either wrong produces a
 * number that is confidently wrong rather than obviously missing:
 *
 *  1. A transaction `amount` is POSITIVE when money LEFT the account. It is
 *     rendered as an outflow (−) and income as an inflow (+). Never inverted.
 *  2. Net worth computed from a subset of accounts is never shown as if it
 *     were complete. When `accounts_counted < accounts_total` the shortfall
 *     is on screen, next to the number, in the same eyeline — along with the
 *     oldest balance timestamp feeding it.
 *
 * The unhappy states (no API keys, a bank in login_required, a sandbox
 * environment full of fake data) are first-class renderings here, not error
 * branches — they're the states this surface spends most of its life in.
 */

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TXN_DAYS = 14;
const SPEND_DAYS = 30;

/* -------------------------------------------------------------- format --- */

/** `$1,234.56` — unsigned. Callers own the sign, because the sign is meaning. */
function usd(n: number, cents = true): string {
  const fixed = Math.abs(n).toFixed(cents ? 2 : 0);
  const [whole = '0', frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}${frac ? `.${frac}` : ''}`;
}

/** Signed, for a figure that can legitimately go either way (net worth). */
function signedUsd(n: number, cents = true): string {
  return `${n < 0 ? '−' : ''}${usd(n, cents)}`;
}

/* The server's timestamps come from SQLite's datetime('now') — naive UTC with
   no zone marker, which `new Date()` would happily misread as local time and
   quietly shift by hours. Parsed literally instead, and labelled UTC so the
   reading is honest rather than plausible. */
const TS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

function fmtStamp(s: string | null): string {
  if (!s) return 'never';
  const m = TS.exec(s);
  if (!m) return s;
  const [, , mo = '', d = '', hh = '', mi = ''] = m;
  return `${MONTHS[Number(mo)] ?? ''} ${Number(d)} · ${hh}:${mi} UTC`;
}

function fmtDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  const [, , mo = '', d = ''] = m;
  return `${MONTHS[Number(mo)] ?? ''} ${Number(d)}`;
}

/** `FOOD_AND_DRINK_RESTAURANT` → `Food and drink restaurant`. */
function humanize(raw: string | null): string {
  if (!raw) return 'Uncategorized';
  const words = raw.toLowerCase().split('_').filter(Boolean);
  const [first = '', ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/* -------------------------------------------------------------- pieces --- */

const STATUS_COPY: Record<PlaidItemStatus, { label: string; tone: 'ok' | 'warn' | 'crit' | 'dim' }> = {
  active: { label: 'connected', tone: 'ok' },
  login_required: { label: 'needs sign-in', tone: 'crit' },
  error: { label: 'error', tone: 'crit' },
  revoked: { label: 'revoked', tone: 'dim' },
};

/** A value that has to be pasted somewhere else — Plaid's dashboard, in both
 *  cases here — so it's a click target rather than something to retype. */
function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const clip = navigator.clipboard;
    if (!clip) return;
    clip
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* denied — the value is on screen and selectable regardless */
      });
  };
  return (
    <div className="money-copy">
      <span className="money-copy-label data">{label}</span>
      <button type="button" className="money-copy-btn" onClick={copy} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
        <span className="money-copy-val data">{value}</span>
        <span className="money-copy-hint data">{copied ? 'copied' : 'copy'}</span>
      </button>
    </div>
  );
}

const SECRETS_DASHBOARD = 'https://secrets.benloe.com';

/**
 * The secrets service is down. NOT a setup panel wearing different words — the
 * distinction is the entire reason `state` exists on the status payload.
 *
 * Both cases render as "Plaid isn't working", but one is Ben's move and the
 * other is mine. Showing the setup steps during an outage would send him to
 * re-paste credentials that were never the problem, and when that failed to fix
 * it he would have no way to tell whether he had pasted them wrong.
 */
function BrokerDownPanel({ status }: { status: PlaidStatus }) {
  return (
    <section className="money-setup" aria-label="Plaid setup">
      <SectionLabel n="01">Secrets service unreachable</SectionLabel>
      <p className="money-setup-lede voice">
        Your credentials are fine — I just can&rsquo;t get to the service that holds them, so no Plaid call can
        be made right now. This is mine to fix, not yours. Nothing has been lost: balances and transactions are
        exactly where the last sync left them, and they resume on their own once the socket is back.
      </p>
      {status.detail && (
        <p className="money-step-body data" role="status">
          {status.detail}
        </p>
      )}
    </section>
  );
}

/**
 * No API keys stored. Deliberately NOT a form: this page never touches a
 * secret, and as of the 2026-08-02 credential split this process could not
 * store one if it tried. Keys go into cabinet-secrets, which holds its own
 * encryption key outside this server; this panel says where, and hands over the
 * two URLs Plaid's dashboard needs.
 */
function SetupPanel({ status }: { status: PlaidStatus }) {
  return (
    <section className="money-setup" aria-label="Plaid setup">
      <SectionLabel n="01">Not connected yet</SectionLabel>
      <p className="money-setup-lede voice">
        I can&rsquo;t reach Plaid — the API keys aren&rsquo;t in the vault yet. Nothing here is broken; this is
        what the surface looks like before it has been given a key.
      </p>

      <ol className="money-setup-steps">
        <li>
          <span className="money-step-n data">1</span>
          <div>
            <p className="money-step-title">Paste the two keys at the secrets dashboard</p>
            <p className="money-step-body">
              They must be named exactly <code className="data">plaid-client-id</code> and{' '}
              <code className="data">plaid-secret</code>. They go in at{' '}
              <a className="data" href={SECRETS_DASHBOARD} target="_blank" rel="noreferrer">
                {SECRETS_DASHBOARD}
              </a>
              , which is the only thing here that can encrypt them — and the only thing that can read them back.
              I never hold either value: I name a credential and that service makes the call. There&rsquo;s no
              field on this page to type a secret into, and there won&rsquo;t be.
            </p>
          </div>
        </li>
        <li>
          <span className="money-step-n data">2</span>
          <div>
            <p className="money-step-title">Register these two URLs in the Plaid dashboard</p>
            <p className="money-step-body">
              The redirect URI has to be allow-listed before any OAuth bank (Bank of America among them) can
              hand the browser back. The webhook is how Plaid tells me a balance moved without being asked.
            </p>
            <div className="money-copies">
              <Copyable label="redirect_uri" value={status.redirect_uri} />
              <Copyable label="webhook_url" value={status.webhook_url} />
            </div>
          </div>
        </li>
        <li>
          <span className="money-step-n data">3</span>
          <div>
            <p className="money-step-title">Reload this page</p>
            <p className="money-step-body">
              Once the keys are in the vault, &ldquo;Link an account&rdquo; appears here and the rest of the
              surface fills in behind it. Give it up to half a minute — I cache the answer to &ldquo;is Plaid set
              up&rdquo; for thirty seconds so that every page, tool and scheduler tick isn&rsquo;t opening a
              socket to ask.
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}

/**
 * Net worth, and the honesty that has to travel with it. `accounts_counted`
 * vs `accounts_total` is rendered whenever they disagree — an account with no
 * current balance silently vanishes from the sum, and the result looks
 * exactly like a real drop.
 */
function NetWorthHeader({ nw }: { nw: NetWorth }) {
  const short = nw.accounts_total - nw.accounts_counted;
  const partial = short > 0;

  const specs: InstrumentSpec[] = [
    {
      kind: 'stat',
      label: 'Net worth',
      big: signedUsd(nw.net_worth, false),
      unit: partial ? 'partial' : undefined,
      sub: `cash + investments − debts${partial ? ` · ${nw.accounts_counted} of ${nw.accounts_total} accounts` : ''}`,
      tone: nw.net_worth < 0 ? 'crit' : 'ok',
      ...(partial ? { tag: `${nw.accounts_counted}/${nw.accounts_total}`, tagTone: 'warn' as const } : {}),
    },
    { kind: 'stat', label: 'Cash', big: usd(nw.cash, false), sub: 'checking + savings' },
    { kind: 'stat', label: 'Investments', big: usd(nw.investments, false), sub: 'brokerage + retirement' },
    {
      kind: 'stat',
      label: 'Credit owed',
      big: usd(nw.credit, false),
      sub: nw.loans > 0 ? `plus ${usd(nw.loans, false)} in loans` : 'cards, balance outstanding',
      tone: nw.credit > 0 ? 'warn' : 'default',
    },
  ];

  return (
    <section className="money-networth" aria-label="Net worth">
      <SectionLabel n="01">Where you stand</SectionLabel>
      <div className="money-nw-grid">
        {specs.map((spec, i) => (
          <Instrument key={`nw-${i}`} spec={spec} />
        ))}
      </div>
      {partial && (
        <p className="money-caveat" role="status">
          <span className="money-caveat-mark" aria-hidden="true">
            △
          </span>
          Computed from {nw.accounts_counted} of {nw.accounts_total} accounts — {short}{' '}
          {short === 1 ? 'has' : 'have'} no current balance, so {short === 1 ? 'it is' : 'they are'} missing from
          this total. Treat it as a floor, not the figure.
        </p>
      )}
      <p className="money-asof data">
        Balances as of {fmtStamp(nw.stalest_balance_at)}
        {nw.stalest_balance_at ? ' (oldest contributing)' : ''}
      </p>
    </section>
  );
}

interface Group {
  item: PlaidItemSummary | null;
  label: string;
  accounts: FinancialAccount[];
}

/**
 * Accounts hang off institutions, and the institution ("item", in Plaid's
 * vocabulary) is the thing that breaks, gets repaired, and gets unlinked — so
 * the item is the outer loop, not the account.
 *
 * The join is by institution NAME because /api/plaid/status returns accounts
 * carrying `institution_name` and `item_status` but no item id. Two items at
 * the same institution would fold into one group; accounts matching no item
 * land in their own group rather than being dropped.
 */
function groupAccounts(items: PlaidItemSummary[], accounts: FinancialAccount[]): Group[] {
  const groups: Group[] = items.map((item) => ({
    item,
    label: item.institution ?? `Institution #${item.id}`,
    accounts: [],
  }));
  const byName = new Map<string, Group>();
  for (const g of groups) if (g.item?.institution) byName.set(g.item.institution, g);

  const orphans: FinancialAccount[] = [];
  for (const a of accounts) {
    const g = a.institution_name ? byName.get(a.institution_name) : undefined;
    if (g) g.accounts.push(a);
    else orphans.push(a);
  }
  if (orphans.length > 0) groups.push({ item: null, label: 'Unmatched accounts', accounts: orphans });
  return groups;
}

function AccountRow({
  account,
  busy,
  onToggleHidden,
}: {
  account: FinancialAccount;
  busy: boolean;
  onToggleHidden: () => void;
}) {
  const hidden = account.hidden === 1;
  // Credit and loan balances arrive positive-as-owed. Showing them beside a
  // cash balance without saying so would read as money you have.
  const owed = account.type === 'credit' || account.type === 'loan';
  const bal = account.current_balance;

  return (
    <li className={`money-acct${hidden ? ' is-hidden' : ''}`}>
      <div className="money-acct-id">
        <span className="money-acct-name">{account.name ?? 'Unnamed account'}</span>
        <span className="money-acct-meta data">
          {account.mask ? `••${account.mask}` : 'no mask'} · {account.subtype ?? account.type ?? 'account'}
          {hidden ? ' · hidden from totals' : ''}
        </span>
      </div>
      <div className="money-acct-bal">
        {bal === null ? (
          <span className="money-acct-nobal data">no balance</span>
        ) : (
          <>
            <span className={`money-acct-num data${owed ? ' owed' : ''}`}>{usd(bal)}</span>
            {owed && <span className="money-acct-owed data">owed</span>}
            {!owed && account.available_balance !== null && account.available_balance !== bal && (
              <span className="money-acct-owed data">{usd(account.available_balance)} available</span>
            )}
          </>
        )}
      </div>
      <button type="button" className="money-btn subtle tiny" disabled={busy} onClick={onToggleHidden}>
        {busy ? '…' : hidden ? 'Show' : 'Hide'}
      </button>
    </li>
  );
}

function TransactionsTable({ transactions }: { transactions: MoneyTransaction[] }) {
  return (
    <section className="money-txns" aria-label="Recent transactions">
      <SectionLabel n="03">Recent activity</SectionLabel>
      <p className="money-lede data">Last {TXN_DAYS} days. Outflows are marked −, money in +.</p>
      {transactions.length === 0 ? (
        <p className="money-empty voice">Nothing has moved in the last {TXN_DAYS} days.</p>
      ) : (
        <table className="money-grid">
          <thead>
            <tr>
              <th scope="col">date</th>
              <th scope="col">merchant</th>
              <th scope="col">category</th>
              <th scope="col">account</th>
              <th scope="col" className="num">
                amount
              </th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => {
              // POSITIVE amount = money spent. This is the one line in the
              // surface where an inverted sign would look entirely plausible.
              const outflow = t.amount >= 0;
              const pending = t.pending === 1;
              return (
                <tr key={t.transaction_id} className={pending ? 'is-pending' : undefined}>
                  <td className="data">{fmtDate(t.date)}</td>
                  <th scope="row">
                    <span className="money-merchant">{t.merchant ?? 'Unknown'}</span>
                    {pending && (
                      <span className="money-chip pending" title="Provisional — the amount and merchant can still change">
                        pending
                      </span>
                    )}
                  </th>
                  <td className="money-cat">{humanize(t.category_primary)}</td>
                  <td className="data money-acct-cell">
                    {t.account ?? '—'}
                    {t.mask ? ` ••${t.mask}` : ''}
                  </td>
                  <td className={`num data money-amt ${outflow ? 'out' : 'in'}`}>
                    {outflow ? '−' : '+'}
                    {usd(t.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CategoryPanel({ categories }: { categories: CategorySpend[] }) {
  const total = categories.reduce((s, c) => s + c.spent, 0);
  const peak = categories.reduce((m, c) => Math.max(m, c.spent), 0);

  return (
    <section className="money-cats" aria-label="Spending by category">
      <SectionLabel n="04">Where it went</SectionLabel>
      <p className="money-lede data">
        Last {SPEND_DAYS} days · {usd(total)} out across {categories.length} categor
        {categories.length === 1 ? 'y' : 'ies'}
      </p>
      {categories.length === 0 ? (
        <p className="money-empty voice">No categorised spending in the window yet.</p>
      ) : (
        <ul className="money-cat-list">
          {categories.map((c) => (
            <li key={c.category} className="money-cat-row">
              <span className="money-cat-name">{humanize(c.category)}</span>
              <span className="money-cat-bar" aria-hidden="true">
                <span className="money-cat-fill" style={{ width: `${peak > 0 ? (c.spent / peak) * 100 : 0}%` }} />
              </span>
              <span className="money-cat-amt data">{usd(c.spent)}</span>
              <span className="money-cat-n data">
                {c.txns} txn{c.txns === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HoldingsPanel({ holdings }: { holdings: Holding[] }) {
  const total = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  return (
    <section className="money-holdings" aria-label="Holdings">
      <SectionLabel n="05">Holdings</SectionLabel>
      {holdings.length === 0 ? (
        <p className="money-empty voice">
          No investment accounts linked. Nothing&rsquo;s wrong — there&rsquo;s simply nothing to price yet.
        </p>
      ) : (
        <>
          <p className="money-lede data">{usd(total)} across {holdings.length} positions</p>
          <table className="money-grid">
            <thead>
              <tr>
                <th scope="col">ticker</th>
                <th scope="col">security</th>
                <th scope="col">account</th>
                <th scope="col" className="num">
                  qty
                </th>
                <th scope="col" className="num">
                  price
                </th>
                <th scope="col" className="num">
                  value
                </th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => (
                <tr key={`${h.ticker ?? h.security ?? 'holding'}-${i}`}>
                  <td className="data">{h.ticker ?? '—'}</td>
                  <th scope="row">{h.security ?? 'Unnamed security'}</th>
                  <td className="data money-acct-cell">{h.account ?? h.institution ?? '—'}</td>
                  <td className="num data">{h.quantity === null ? '—' : h.quantity.toFixed(3)}</td>
                  <td className="num data">{h.price === null ? '—' : usd(h.price)}</td>
                  <td className="num data">{h.value === null ? '—' : usd(h.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- surface --- */

export function Money() {
  const [status, setStatus] = useState<PlaidStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<MoneyTransaction[]>([]);
  const [categories, setCategories] = useState<CategorySpend[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [tick, setTick] = useState(0);

  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncReports, setSyncReports] = useState<SyncReport[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [acctBusy, setAcctBusy] = useState<Record<number, boolean>>({});
  const [pendingUnlink, setPendingUnlink] = useState<PlaidItemSummary | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const handlerRef = useRef<PlaidHandler | null>(null);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    api
      .plaidStatus()
      .then((s) => {
        if (!live) return;
        setStatus(s);
        setStatusError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setStatus(null);
        setStatusError(errText(e, "Couldn't read the connection status."));
      });
    return () => {
      live = false;
    };
  }, [tick]);

  // The ledger reads are independent of the connection state on purpose: rows
  // already in the database stay readable even if Plaid is unreachable today.
  useEffect(() => {
    let live = true;
    api
      .moneyTransactions({ days: TXN_DAYS, limit: 100 })
      .then((r) => live && setTransactions(r.transactions))
      .catch(() => live && setTransactions([]));
    api
      .moneyCategories(SPEND_DAYS)
      .then((r) => live && setCategories(r.categories))
      .catch(() => live && setCategories([]));
    api
      .moneyHoldings()
      .then((r) => live && setHoldings(r.holdings))
      .catch(() => live && setHoldings([]));
    return () => {
      live = false;
    };
  }, [tick]);

  // Link is a modal owned by a third-party script, not by React — if this
  // surface unmounts while it's open, tear it down explicitly.
  useEffect(
    () => () => {
      handlerRef.current?.destroy();
      handlerRef.current = null;
    },
    [],
  );

  /** `itemId` set = update mode: repair the existing connection rather than adding a second one. */
  const runLink = useCallback(
    (itemId?: number) => {
      setLinking(true);
      setLinkError(null);
      setNote(null);
      api
        .plaidLinkToken(itemId)
        .then(async ({ link_token }) => {
          // Stashed BEFORE opening: an OAuth bank navigates the whole tab
          // away, so /plaid/oauth has to find this token on a cold load.
          stashLinkToken(link_token);
          handlerRef.current?.destroy();
          handlerRef.current = await openPlaidLink({
            token: link_token,
            onSuccess: (publicToken) => {
              clearLinkToken();
              api
                .plaidExchange(publicToken)
                .then((res) => {
                  setNote(
                    `${res.item.institution ?? 'That institution'} is linked. Pulling history now — it can take a minute to fill in.`,
                  );
                  reload();
                })
                .catch((e: unknown) => setLinkError(errText(e, "The link didn't complete.")))
                .finally(() => setLinking(false));
            },
            onExit: (err) => {
              clearLinkToken();
              setLinking(false);
              if (err) {
                setLinkError(err.display_message ?? err.error_message ?? `Link closed: ${err.error_code ?? 'unknown error'}`);
              }
            },
          });
        })
        .catch((e: unknown) => {
          clearLinkToken();
          setLinking(false);
          setLinkError(errText(e, "Couldn't open Plaid Link."));
        });
    },
    [reload],
  );

  const runSync = useCallback(
    (itemId?: number) => {
      setSyncing(true);
      setSyncError(null);
      setSyncReports(null);
      api
        .plaidSync(itemId)
        .then((res) => {
          setSyncReports(res.reports);
          reload();
        })
        .catch((e: unknown) => setSyncError(errText(e, 'The sync failed.')))
        .finally(() => setSyncing(false));
    },
    [reload],
  );

  const toggleHidden = useCallback((account: FinancialAccount) => {
    const next = account.hidden !== 1;
    setAcctBusy((b) => ({ ...b, [account.id]: true }));
    api
      .plaidSetAccountHidden(account.id, next)
      .then(() =>
        // Patch in place rather than refetching: the whole surface flickering
        // because one row was hidden is worse than a one-field local update.
        setStatus((s) =>
          s ? { ...s, accounts: s.accounts.map((a) => (a.id === account.id ? { ...a, hidden: next ? 1 : 0 } : a)) } : s,
        ),
      )
      .catch(() => {
        /* the row stays as it was; a reload will show the truth */
      })
      .finally(() =>
        setAcctBusy((b) => {
          const { [account.id]: _drop, ...rest } = b;
          return rest;
        }),
      );
  }, []);

  const confirmUnlink = useCallback(() => {
    if (!pendingUnlink) return;
    setUnlinking(true);
    setUnlinkError(null);
    api
      .plaidUnlinkItem(pendingUnlink.id)
      .then(() => {
        setPendingUnlink(null);
        reload();
      })
      .catch((e: unknown) => setUnlinkError(errText(e, "Couldn't unlink that institution.")))
      .finally(() => setUnlinking(false));
  }, [pendingUnlink, reload]);

  const groups = useMemo(() => (status ? groupAccounts(status.items, status.accounts) : []), [status]);
  const broken = status?.items.filter((i) => i.status !== 'active' && i.status !== 'revoked') ?? [];

  if (!status) {
    return (
      <section className="money" aria-label="Money">
        <p className={statusError ? 'money-empty voice' : 'money-loading data'}>
          {statusError ?? 'Opening the books…'}
        </p>
      </section>
    );
  }

  const env = status.environment;

  return (
    <section className="money" aria-label="Money">
      <header className="money-head">
        <div>
          <SectionLabel n="00">The books</SectionLabel>
          <p className="money-lede voice">
            Every linked account, what it holds, and where the money went. Numbers here are only ever as
            complete as the connections behind them — so both are on the same page.
          </p>
        </div>
        <div className="money-head-side">
          <span className={`money-env ${env}`} title={env === 'sandbox' ? "Plaid's sandbox — the data below is fabricated" : 'Live Plaid data'}>
            {env}
          </span>
          {status.configured && (
            <div className="money-actions">
              <button type="button" className="money-btn" disabled={linking} onClick={() => runLink()}>
                {linking ? 'Opening Link…' : 'Link an account'}
              </button>
              <button type="button" className="money-btn subtle" disabled={syncing} onClick={() => runSync()}>
                {syncing ? (
                  <>
                    <span className="money-spinner" aria-hidden="true" />
                    Syncing…
                  </>
                ) : (
                  'Sync now'
                )}
              </button>
            </div>
          )}
        </div>
      </header>

      {env === 'sandbox' && (
        <p className="money-sandbox" role="status">
          <strong>Sandbox.</strong> Every figure below comes from Plaid&rsquo;s test environment. It is not your
          money and none of it is real — treat it as a wiring diagram, not a balance.
        </p>
      )}

      {note && <p className="money-note data">{note}</p>}
      {linkError && <p className="money-error data">{linkError}</p>}

      {status.state === 'unreachable' ? (
        // Checked before `configured`, because an unreachable secrets service
        // reports configured: false — every caller uses that flag to decide
        // whether attempting a call is worth it, and against a dead socket it
        // isn't. The flag is right; it just isn't the whole answer, and the
        // setup steps would be actively misleading advice here.
        <BrokerDownPanel status={status} />
      ) : !status.configured ? (
        <SetupPanel status={status} />
      ) : (
        <>
          {broken.length > 0 && (
            <p className="money-alert" role="status">
              <span className="money-caveat-mark" aria-hidden="true">
                △
              </span>
              {broken.length === 1 ? 'One institution needs' : `${broken.length} institutions need`} attention —
              balances and transactions from{' '}
              {broken.map((i) => i.institution ?? `item #${i.id}`).join(', ')} are frozen where they were until{' '}
              {broken.length === 1 ? 'it is' : 'they are'} reconnected.
            </p>
          )}

          <NetWorthHeader nw={status.net_worth} />

          {(syncReports || syncError) && (
            <section className="money-sync" aria-label="Sync result">
              {syncError ? (
                <p className="money-error data">{syncError}</p>
              ) : (
                <ul className="money-sync-list">
                  {syncReports?.map((r) => (
                    <li key={r.item_id} className={`data${r.ok ? '' : ' bad'}`}>
                      <b>{r.institution ?? `item #${r.item_id}`}</b>{' '}
                      {r.ok
                        ? `— ${r.transactions.added} new, ${r.transactions.modified} updated, ${r.transactions.removed} removed${r.transactions.skipped > 0 ? `, ${r.transactions.skipped} skipped` : ''} · ${r.accounts} account${r.accounts === 1 ? '' : 's'}${r.holdings > 0 ? ` · ${r.holdings} holdings` : ''}`
                        : `— ${r.error ?? r.status ?? 'failed'}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="money-accounts" aria-label="Accounts">
            <SectionLabel n="02">Linked accounts</SectionLabel>
            {groups.length === 0 ? (
              <p className="money-empty voice">
                Nothing linked yet. &ldquo;Link an account&rdquo; opens Plaid and takes about a minute.
              </p>
            ) : (
              <div className="money-groups">
                {groups.map((g) => {
                  const item = g.item; // const, so the null-narrowing survives into the callbacks below
                  const st = item ? STATUS_COPY[item.status] : null;
                  return (
                    <article key={item ? `item-${item.id}` : 'orphans'} className="money-group">
                      <div className="money-group-head">
                        <div className="money-group-id">
                          <h3 className="money-group-name">{g.label}</h3>
                          {st && <span className={`money-chip ${st.tone}`}>{st.label}</span>}
                          {item?.error_code && <span className="money-chip crit data">{item.error_code}</span>}
                        </div>
                        <div className="money-group-side">
                          {item && (
                            <span className="money-group-synced data">synced {fmtStamp(item.last_synced_at)}</span>
                          )}
                          {item && item.status === 'login_required' && (
                            <button
                              type="button"
                              className="money-btn danger"
                              disabled={linking}
                              onClick={() => runLink(item.id)}
                            >
                              Reconnect
                            </button>
                          )}
                          {item && (
                            <button
                              type="button"
                              className="money-btn subtle tiny"
                              onClick={() => {
                                setUnlinkError(null);
                                setPendingUnlink(item);
                              }}
                            >
                              Unlink
                            </button>
                          )}
                        </div>
                      </div>

                      {item?.status === 'login_required' && (
                        <p className="money-group-why">
                          {g.label} wants you to sign in again — Plaid&rsquo;s access expired or the bank revoked
                          it. Until then these balances are frozen at their last good read and are excluded from
                          the totals above.
                        </p>
                      )}
                      {item?.status === 'error' && (
                        <p className="money-group-why">
                          Plaid returned <code className="data">{item.error_code ?? 'an unspecified error'}</code>{' '}
                          for this institution. A sync may clear it; if it doesn&rsquo;t, reconnecting will.
                        </p>
                      )}
                      {item?.consent_expiration_time && (
                        <p className="money-group-why data">
                          Consent expires {fmtStamp(item.consent_expiration_time)}
                        </p>
                      )}

                      {g.accounts.length === 0 ? (
                        <p className="money-empty small voice">No accounts have come back from this institution yet.</p>
                      ) : (
                        <ul className="money-acct-list">
                          {g.accounts.map((a) => (
                            <AccountRow
                              key={a.id}
                              account={a}
                              busy={Boolean(acctBusy[a.id])}
                              onToggleHidden={() => toggleHidden(a)}
                            />
                          ))}
                        </ul>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <TransactionsTable transactions={transactions} />
          <CategoryPanel categories={categories} />
          <HoldingsPanel holdings={holdings} />
        </>
      )}

      {pendingUnlink && (
        <ConfirmDialog
          title={`Unlink ${pendingUnlink.institution ?? 'this institution'}?`}
          body={
            <>
              This revokes Plaid&rsquo;s access and deletes every account, transaction and holding that came from{' '}
              {pendingUnlink.institution ?? 'it'}. History is not kept — relinking starts the backfill over.
            </>
          }
          confirmLabel={unlinking ? 'Unlinking…' : 'Unlink'}
          error={unlinkError}
          busy={unlinking}
          onConfirm={confirmUnlink}
          onCancel={() => {
            if (unlinking) return;
            setPendingUnlink(null);
            setUnlinkError(null);
          }}
        />
      )}
    </section>
  );
}
