import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/cabinet.js';
import type {
  MemoryView,
  MemoryFile,
  MemoryLesson,
  RecallResponse,
  RecallResult,
  RecallSource,
} from '../lib/cabinet.js';
import { Card, SectionLabel } from '../components/instruments/index.js';
import './brain.css';

/** Human labels for the five recall sources — Cabinet keeps its terms plain. */
const SOURCE_LABEL: Record<RecallSource, string> = {
  fact: 'Fact',
  episodic: 'Episodic',
  chat: 'Chat',
  lesson: 'Lesson',
  document: 'Document',
};

/** "edited Jul 8" or "never edited" — a terse provenance line for a file. */
function editedLine(iso: string | null): string {
  if (!iso) return 'never edited';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never edited';
  return `edited ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/**
 * BRAIN — what Cabinet knows about Ben. Two halves: a unified recall search
 * across every store (facts, episodic, chats, lessons, documents) with the
 * provenance and score on the record; and the standing memory — the authored
 * files Ben signs, plus the lessons Cabinet has drawn on its own.
 */
export function Brain() {
  const [memory, setMemory] = useState<MemoryView | null>(null);
  const [memError, setMemError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .memory()
      .then((m) => {
        if (alive) setMemory(m);
      })
      .catch((e: unknown) => {
        if (alive) setMemError(e instanceof Error ? e.message : 'Could not reach the archive.');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="brain">
      <header className="brain__head">
        <h1>Brain</h1>
        <p className="brain__sub voice">What I know about you, and where I got it.</p>
      </header>

      <Recall />

      <section className="brain__section">
        <SectionLabel n="02">Memory</SectionLabel>
        {memError ? (
          <p className="brain__empty voice">Can't reach the archive right now. {memError}</p>
        ) : !memory ? (
          <p className="brain__loading label">Opening the archive…</p>
        ) : (
          <MemoryBlock memory={memory} />
        )}
      </section>
    </div>
  );
}

/* ---- Recall: the unified search ---------------------------------------- */
function Recall() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<RecallResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    api
      .recall(q)
      .then((r) => setResponse(r))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Recall failed.'))
      .finally(() => setSearching(false));
  };

  return (
    <section className="brain__section">
      <SectionLabel n="01">Recall</SectionLabel>
      <form className="recall__form" onSubmit={submit} role="search">
        <input
          className="recall__input data"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask what I remember…"
          aria-label="Search everything Cabinet remembers"
        />
        <button className="recall__go" type="submit" disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Recall'}
        </button>
      </form>

      {error ? (
        <p className="brain__empty voice">{error}</p>
      ) : response ? (
        response.results.length > 0 ? (
          <ul className="recall__results">
            {response.results.map((r, i) => (
              <RecallHit key={`${r.ref}-${i}`} hit={r} />
            ))}
          </ul>
        ) : (
          <p className="brain__empty voice">
            Nothing on “{response.query}.” Either I haven't seen it, or it never happened.
          </p>
        )
      ) : (
        <p className="brain__hint voice">
          Search facts, past days, chats, lessons, and documents in one pass.
        </p>
      )}
    </section>
  );
}

function RecallHit({ hit }: { hit: RecallResult }) {
  return (
    <li className="hit">
      <div className="hit__top">
        <span className={`hit__chip hit__chip--${hit.source}`}>{SOURCE_LABEL[hit.source]}</span>
        <span className="hit__title">{hit.title}</span>
        <span className="hit__score data" title="match score">
          {Math.round(hit.score * 100)}%
        </span>
      </div>
      <p className="hit__snippet">{hit.snippet}</p>
      <div className="hit__prov data">{hit.provenance}</div>
    </li>
  );
}

/* ---- Memory: files + lessons ------------------------------------------- */
function MemoryBlock({ memory }: { memory: MemoryView }) {
  const { files, lessons } = memory;
  return (
    <div className="mem">
      <div className="mem__files">
        {files.length === 0 ? (
          <p className="brain__empty voice">No standing files yet — nothing on the record to sign.</p>
        ) : (
          files.map((f) => <FileCard key={f.name} file={f} />)
        )}
      </div>

      <div className="mem__lessons">
        <SectionLabel>Lessons drawn</SectionLabel>
        {lessons.length === 0 ? (
          <p className="brain__empty voice">Nothing learned worth keeping yet.</p>
        ) : (
          <ul className="lessons">
            {lessons.map((l) => (
              <LessonRow key={l.id} lesson={l} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One memory file. Editable files are a paper card Ben authors and signs;
    read-only files are the same paper, set behind glass. */
function FileCard({ file }: { file: MemoryFile }) {
  const [draft, setDraft] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== file.content;

  const save = () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    api
      .saveMemoryFile(file.name, draft)
      .then((res) => {
        if (res.ok) setSavedAt(new Date().toISOString());
        else setError("Save didn't take.");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Save didn't take."))
      .finally(() => setSaving(false));
  };

  const meta = savedAt ? editedLine(savedAt) : editedLine(file.updatedAt);

  return (
    <Card paper cap={file.name} className="file">
      {file.editable ? (
        <>
          <textarea
            className="file__edit"
            value={draft}
            spellCheck={false}
            aria-label={`Contents of ${file.name}`}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="file__foot">
            <span className="file__meta">{error ?? (dirty ? 'unsaved changes' : meta)}</span>
            <button
              className="file__save"
              type="button"
              onClick={save}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        <>
          <pre className="file__read">{file.content}</pre>
          <div className="file__foot">
            <span className="file__meta">{meta} · read-only</span>
          </div>
        </>
      )}
    </Card>
  );
}

function LessonRow({ lesson }: { lesson: MemoryLesson }) {
  const pct = useMemo(() => Math.round(lesson.confidence * 100), [lesson.confidence]);
  return (
    <li className="lesson">
      <p className="lesson__text">{lesson.text}</p>
      <div className="lesson__meta">
        <span className="lesson__domain data">{lesson.domain ?? 'general'}</span>
        <span className="lesson__conf data" title="confidence">
          {pct}%
        </span>
      </div>
    </li>
  );
}
