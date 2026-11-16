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
// install.sh. The /usr/local/bin/relay wrapper drops to the `relay-cli` user
// with setpriv before node starts, so nothing here ever executes as root, and
// nothing here runs as `relay`, the uid of the internet-facing server.
//
// The server's uid can write this database, so everything read from it is
// untrusted here. Every string that comes out of it is passed through
// clean() or cleanLine() before it is printed, and so is the message of any
// error (a trigger in the database can put whatever text it likes into one).
// The only other things printed from it are numbers: counts and row ids.
import { readFileSync, writeSync } from 'node:fs';
import { openDb, createToken, listTokens, revokeTokens, notExpired, addMessage, getMessages, getMessage, markRead, formatMessage, formatWithin, inboxBatch, cleanLine, LOCAL_SENDER as ME } from './db.mjs';

// For this file's own messages. Nothing from the database goes through here.
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

// Everything this command prints to stdout goes through here, not through
// console.log, which drops a failed write (a closed pipe, a full disk)
// without a word. This throws instead, so `inbox` never marks as read what
// it could not write out, and the command exits 1.
function say(text = '') {
  const buf = Buffer.from(`${text}\n`);
  for (let off = 0; off < buf.length; ) {
    try {
      off += writeSync(1, buf, off);
    } catch (e) {
      if (e.code !== 'EAGAIN') throw e; // a pipe that is full for the moment: try again
    }
  }
}

if (process.getuid?.() === 0) die('relay: refusing to run as root; use /usr/local/bin/relay, which drops to the relay-cli user');

const args = process.argv.slice(2);
// --name <value>. A missing value is an error, not an empty string.
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) die(`relay: ${name} needs a value`);
  args.splice(i, 2);
  return v;
};
const has = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};

// Called by every command except `send` (whose arguments are the message)
// once it has taken the options and arguments it knows. Anything left over
// stops the command: a mistyped option that was
// quietly ignored would mark messages read that the caller meant only to
// look at (inbox --peak), or issue a token with the default lifetime instead
// of the short one asked for (token create --tll 1h).
//   words: how many arguments the command line may have, the command's own
//          name(s) included.
function nothingElse(words, usage) {
  const stray = args.find((x) => x.startsWith('--'));
  if (stray) die(`relay: unknown option ${stray}\nusage: ${usage}`);
  if (args.length > words) die(`relay: unexpected "${args.slice(words).join(' ')}"\nusage: ${usage}`);
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

function main() {
  const [cmd, sub] = args.length ? args : ['help'];

  if (cmd === 'inbox') {
    const peek = has('--peek');
    nothingElse(1, 'relay inbox [--peek]');
    const db = openDb();
    const { total, text, left, upTo } = inboxBatch(db, ME, LIMITS);
    if (!total) say('No new messages.');
    else {
      say(`${total} new message${total > 1 ? 's' : ''}:\n`);
      text.forEach((t) => say(t));
      if (left) say(`${left} more unread not shown yet. Run relay inbox again.`);
      // Marked only now, after the text has been written out.
      if (!peek) markRead(db, ME, upTo);
    }
  } else if (cmd === 'send') {
    // The rest of the line is the message, so only its first word is checked:
    // `relay send --peek` is far more likely a slip than a message. Anything
    // after the first word is sent as written, option-shaped or not.
    if ((args[1] ?? '').startsWith('--')) die('relay: send takes no options. For text that begins with "--", pipe it: relay send -');
    const text = args.slice(1).join(' ');
    const body = !text || text === '-' ? readFileSync(0, 'utf8') : text;
    const r = addMessage(openDb(), ME, body);
    say(`Sent #${Number(r.id)} as ${ME}.`);
  } else if (cmd === 'show') {
    nothingElse(2, 'relay show <id>');
    const m = /^\d+$/.test(sub || '') ? getMessage(openDb(), Number(sub)) : null;
    if (!m) die('relay show <id>: no such message');
    say(formatMessage(m));
  } else if (cmd === 'log') {
    nothingElse(2, 'relay log [n]');
    if (sub !== undefined && !/^[1-9]\d{0,8}$/.test(sub)) die('relay log [n]: n is a whole number, 1 or more');
    const n = Number(sub ?? 20);
    const msgs = getMessages(openDb(), { limit: Math.min(n, 1000) });
    if (!msgs.length) say('No messages yet.');
    // Newest first into the budget, printed oldest first.
    const { text } = formatWithin(msgs.toReversed(), LIMITS);
    if (text.length < msgs.length) say(`(${msgs.length - text.length} older not shown; relay show <id> prints one in full)\n`);
    text.reverse().forEach((t) => say(t));
  } else if (cmd === 'token' && sub === 'create') {
    const usage = 'relay token create <agent> [--ttl 7d] [--note "..."]';
    const ttl = flag('--ttl') ?? '7d';
    const note = flag('--note');
    nothingElse(3, usage);
    const agent = args[2];
    if (!agent) die(usage);
    const t = createToken(openDb(), agent, ttlMs(ttl), note);
    say(`Token ${t.id} for ${t.agent}, expires ${t.expires_at}.`);
    say('This is the only time it is shown:\n');
    say(t.token);
  } else if (cmd === 'token' && sub === 'list') {
    nothingElse(2, 'relay token list');
    const rows = listTokens(openDb());
    if (!rows.length) say('No tokens.');
    for (const t of rows) {
      const state = t.revoked_at ? `REVOKED ${t.revoked_at}` : notExpired(t) ? `live until ${t.expires_at}` : `EXPIRED ${t.expires_at}`;
      const used = t.last_used_at ? `last used ${t.last_used_at} from ${t.last_ip}` : 'never used';
      say(cleanLine(`${t.id}  ${String(t.agent).padEnd(10)} ${state}; ${used}${t.note ? `; ${t.note}` : ''}`));
    }
  } else if (cmd === 'token' && sub === 'revoke') {
    const usage = 'relay token revoke <id | agent | --all>';
    const all = has('--all');
    nothingElse(all ? 2 : 3, usage);
    const which = all ? '--all' : args[2];
    if (!which) die(usage);
    const n = revokeTokens(openDb(), which);
    if (!n) die('Nothing live matched; no token was revoked.');
    say(`Revoked ${n} token${n > 1 ? 's' : ''}. Effective immediately.`);
  } else {
    say(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(4, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    if (cmd !== 'help') process.exit(1);
  }
}

try {
  main();
} catch (e) {
  // Not the stack, and not raw: the message can carry text from the database.
  console.error(cleanLine(`relay: ${e?.message ?? e}`));
  process.exit(1);
}
