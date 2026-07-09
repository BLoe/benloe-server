import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMBEDDING_DIMS } from '../src/embeddings/index.js';
import { EpisodicStore } from '../src/episodic/index.js';

let dir: string;
let store: EpisodicStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cabinet-episodic-'));
  store = new EpisodicStore(join(dir, 'episodic.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A unit vector on axis `dim`, with a small perturbation so ties don't collide. */
function axisVector(dim: number, jitter = 0): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMS);
  v[dim] = 1;
  if (jitter !== 0) v[(dim + 1) % EMBEDDING_DIMS] = jitter;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm) as Float32Array;
}

describe('EpisodicStore.searchChunks kind filter', () => {
  it('returns the true top-k of a minority kind, not just whatever survives a fixed over-fetch window', () => {
    // 20 'document' chunks all clustered near the query vector — a plausible shape
    // after one big PDF import — plus 3 'conversation' chunks that are the actual
    // best matches for THIS query but rank behind the document cluster overall.
    const query = axisVector(0);
    for (let i = 0; i < 20; i++) {
      store.insertChunk('document', `doc-${i}`, null, `doc chunk ${i}`, axisVector(0, 0.01 * (i + 1)));
    }
    for (let i = 0; i < 3; i++) {
      store.insertChunk('conversation', `convo-${i}`, null, `convo chunk ${i}`, axisVector(0, 0.5 + 0.01 * i));
    }

    const hits = store.searchChunks(query, 3, 'conversation');

    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.kind === 'conversation')).toBe(true);
  });

  it('returns an empty array rather than throwing when the corpus is empty', () => {
    expect(store.searchChunks(axisVector(0), 3, 'conversation')).toEqual([]);
  });
});

describe('EpisodicStore.searchLessons active-status filter', () => {
  it('returns the true top-k active lessons even when retired lessons dominate the corpus', () => {
    const query = axisVector(0);
    for (let i = 0; i < 20; i++) {
      const id = store.insertLesson(`retired lesson ${i}`, 'general', 'evidence', 0.8, axisVector(0, 0.01 * (i + 1)));
      store.setLessonStatus(id, 'retired');
    }
    for (let i = 0; i < 4; i++) {
      store.insertLesson(`active lesson ${i}`, 'general', 'evidence', 0.8, axisVector(0, 0.5 + 0.01 * i));
    }

    const hits = store.searchLessons(query, 4);

    expect(hits).toHaveLength(4);
    expect(hits.every((h) => h.status === 'active')).toBe(true);
  });
});
