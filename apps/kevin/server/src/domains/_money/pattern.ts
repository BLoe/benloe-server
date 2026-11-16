// The pattern language of a money rule whose match type is 'regex'.
//
// The name is historical. Rule patterns can be written by the model, they are matched on the server's
// one thread against every imported transaction, and a JavaScript regular expression that has started
// matching cannot be stopped: a short hostile pattern can keep the thread busy for hours. So no
// pattern from a rule is ever handed to the regular-expression engine. A rule's pattern is instead
// this small language, matched below by plain string search, whose cost is at most the length of
// the pattern times the length of the text:
//
//   pattern      := alternative ( "|" alternative )*
//   alternative  := [ "^" | "\b" ] text [ "$" | "\b" ]
//   text         := ordinary characters; "\" before a punctuation character makes it literal
//
//   \b   a word edge: the text starts (or ends) where a word starts (or ends)   \bshell\b
//   ^ $  the start and the end of the description, or of the merchant name     ^sq \*
//   |    either alternative                                                     \blyft\b|\buber\b
//
// Everything else that means something in a regular expression (. * + ? ( ) [ ] { }) is refused
// unless escaped, so that a pattern never silently means something different from what was typed.
// Matching ignores case.

interface Alternative {
  text: string;
  /** What must hold where the text begins and ends. */
  start: 'any' | 'word' | 'line';
  end: 'any' | 'word' | 'line';
}

const SPECIAL = '.*+?()[]{}^$|\\';
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

/** Parses a rule pattern. Throws a plain Error, written for whoever typed the pattern, when it is not in the language. */
export function parsePattern(pattern: string): Alternative[] {
  const no = (why: string): never => {
    throw new Error(
      `"${pattern}" cannot be used as a rule: ${why}. A pattern is plain text, with \\b for a word edge, ^ and $ for the start and end of the description, | between alternatives, and a backslash before any of . * + ? ( ) [ ] { } to mean that character itself. For anything else use a "contains" rule.`,
    );
  };
  if (pattern.length > 200) no('it is longer than 200 characters');
  const out: Alternative[] = [];
  let cur: Alternative = { text: '', start: 'any', end: 'any' };
  /** Set once an end marker has been read: nothing but "|" may follow it. */
  let closed = false;
  const finish = () => {
    if (!cur.text) no('an alternative has no text to look for');
    out.push({ ...cur, text: cur.text.toLowerCase() });
    cur = { text: '', start: 'any', end: 'any' };
    closed = false;
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '|') {
      finish();
      continue;
    }
    if (closed) no('text follows a $ or a closing \\b');
    if (c === '\\') {
      const next = pattern[++i];
      if (next === undefined) no('it ends with a backslash');
      else if (next === 'b') {
        if (!cur.text && cur.start === 'any') cur.start = 'word';
        else if (cur.text) {
          cur.end = 'word';
          closed = true;
        } else no('\\b appears twice at the start of an alternative');
      } else if (isWordChar(next)) no(`\\${next} is not supported`);
      else cur.text += next;
    } else if (c === '^') {
      if (cur.text || cur.start !== 'any') no('^ is only allowed at the start of an alternative');
      cur.start = 'line';
    } else if (c === '$') {
      if (!cur.text) no('$ is only allowed at the end of an alternative');
      cur.end = 'line';
      closed = true;
    } else if (SPECIAL.includes(c)) no(`"${c}" has a special meaning in regular expressions and is not supported here; write \\${c} to match the character itself`);
    else cur.text += c;
  }
  finish();
  return out;
}

/** Does `text` (a transaction's description and merchant, one per line) match any alternative? */
export function matchesPattern(alternatives: Alternative[], text: string): boolean {
  const hay = text.toLowerCase();
  for (const a of alternatives) {
    for (let at = hay.indexOf(a.text); at !== -1; at = hay.indexOf(a.text, at + 1)) {
      const end = at + a.text.length;
      const startOk = a.start === 'any' || (a.start === 'line' ? at === 0 || hay[at - 1] === '\n' : isWordChar(hay[at - 1]) !== isWordChar(hay[at]));
      const endOk = a.end === 'any' || (a.end === 'line' ? end === hay.length || hay[end] === '\n' : isWordChar(hay[end - 1]) !== isWordChar(hay[end]));
      if (startOk && endOk) return true;
    }
  }
  return false;
}
