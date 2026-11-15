#!/usr/bin/env node
// The local end of the relay, for a Claude Code session on this box (and for
// managing the outside agent's access). Installed as /usr/local/bin/relay.
//
//   relay inbox [--peek]          unread messages from the other side; marks them read
//   relay show <id>               one message in full, however long
//   relay send <text>             post as `claude` (use `-` or pipe stdin for long text)
//   relay log [n]                 last n messages, both directions (default 20)
//   relay token create <agent> [--ttl 7d] [--note "..."]
//   relay token list
//   relay token revoke <id | agent | --all>
//
// Reads and writes the SQLite file directly, so it works with the server down.
//
// This file runs from a root-owned installed copy, never from the repo: see
// install.sh. The /usr/local/bin/relay wrapper drops to the `relay` user with
// setpriv before node starts, so nothing here ever executes as root.
import { readFileSync } from 'node:fs';
import { openDb, createToken, listTokens, revokeTokens, addMessage, getMessages, getMessage, unreadFor, markRead, formatMessage, formatWithin, inboxBatch, clean, LOCAL_SENDER as ME } from './db.mjs';

if (process.getuid?.() === 0) {
  console.error('relay: refusing to run as root; use /usr/local/bin/relay, which drops to the relay user');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v ?? '';
};
const has = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

// A mistyped flag (--peak) must stop the command, not be ignored: on `inbox`
// that would mark messages read that the caller meant only to look at.
function noStrayFlags() {
  const stray = args.find((x) => x.startsWith('--') && x !== '--all');
  if (stray) die(`relay: unknown option ${stray}`);
}

function ttlMs(s) {
  const m = /^(\d+)([mhd])$/.exec(s);
  if (!m) die('--ttl looks like 90m, 12h or 7d');
  return +m[1] * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

// What one `inbox` or `log` call may print, in printed characters. A
// session's tool output is cut off well below a 200,000-character message,
// and a message that scrolled away unseen must not count as read.
const LIMITS = { perMessage: 10_000, budget: 24_000 };

const db = openDb();
const [cmd, sub, ...rest] = args.length ? args : ['help'];

if (cmd === 'inbox') {
  const peek = has('--peek');
  noStrayFlags();
  const { total, text, left, upTo } = inboxBatch(db, ME, LIMITS);
  if (!total) console.log('No new messages.');
  else {
    console.log(`${total} new message${total > 1 ? 's' : ''}:\n`);
    text.forEach((t) => console.log(t));
    if (left) console.log(`${left} more unread not shown yet. Run relay inbox again.`);
    // Marked only now, after the text has been written out.
    if (!peek) markRead(db, ME, upTo);
  }
} else if (cmd === 'send') {
  const text = args.slice(1).join(' ');
  const body = !text || text === '-' ? readFileSync(0, 'utf8') : text;
  try {
    const r = addMessage(db, ME, body);
    console.log(`Sent #${r.id} as ${ME}.`);
  } catch (e) {
    die(e.message);
  }
} else if (cmd === 'show') {
  const m = /^\d+$/.test(sub || '') ? getMessage(db, Number(sub)) : null;
  if (!m) die('relay show <id>: no such message');
  console.log(formatMessage(m));
} else if (cmd === 'log') {
  const n = Number(sub || 20);
  if (!(n >= 1)) die('relay log [n]');
  const msgs = getMessages(db, { limit: Math.min(n, 1000) });
  if (!msgs.length) console.log('No messages yet.');
  // Newest first into the budget, printed oldest first.
  const { text } = formatWithin(msgs.toReversed(), LIMITS);
  if (text.length < msgs.length) console.log(`(${msgs.length - text.length} older not shown; relay show <id> prints one in full)\n`);
  text.reverse().forEach((t) => console.log(t));
} else if (cmd === 'token' && sub === 'create') {
  const ttl = flag('--ttl') ?? '7d';
  const note = flag('--note');
  const agent = args[2];
  if (!agent) die('relay token create <agent> [--ttl 7d] [--note "..."]');
  try {
    const t = createToken(db, agent, ttlMs(ttl), note);
    console.log(`Token ${t.id} for ${t.agent}, expires ${t.expires_at}.`);
    console.log('This is the only time it is shown:\n');
    console.log(t.token);
  } catch (e) {
    die(e.message);
  }
} else if (cmd === 'token' && sub === 'list') {
  const rows = listTokens(db);
  if (!rows.length) console.log('No tokens.');
  for (const t of rows) {
    const state = t.revoked_at ? `REVOKED ${t.revoked_at}` : Date.parse(t.expires_at) <= Date.now() ? `EXPIRED ${t.expires_at}` : `live until ${t.expires_at}`;
    const used = t.last_used_at ? `last used ${t.last_used_at} from ${t.last_ip}` : 'never used';
    // Every field comes from a database the server's uid can write; none reaches the terminal raw.
    console.log(clean(`${t.id}  ${String(t.agent).padEnd(10)} ${state}; ${used}${t.note ? `; ${t.note}` : ''}`).replace(/\n/g, ' '));
  }
} else if (cmd === 'token' && sub === 'revoke') {
  if (!rest[0]) die('relay token revoke <id | agent | --all>');
  const n = revokeTokens(db, rest[0]);
  if (!n) die('Nothing live matched; no token was revoked.');
  console.log(`Revoked ${n} token${n > 1 ? 's' : ''}. Effective immediately.`);
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(4, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  if (cmd !== 'help') process.exit(1);
}
