import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Embedder, EMBEDDING_DIMS, chunkText } from '../src/embeddings/index.js';
import { EpisodicStore } from '../src/episodic/index.js';

// First run downloads the quantized model (~30MB) into PALS_MODELS_DIR.
const MODEL_TIMEOUT = 300_000;

let embedder: Embedder;
let dir: string;
let store: EpisodicStore;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pals-episodic-'));
  store = new EpisodicStore(join(dir, 'episodic.db'));
  embedder = new Embedder();
});

afterAll(async () => {
  await embedder.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('chunkText', () => {
  it('returns single chunk for short text and empty for blank', () => {
    expect(chunkText('hello world')).toEqual(['hello world']);
    expect(chunkText('   ')).toEqual([]);
  });

  it('splits long text with overlap and loses no words', () => {
    const words = Array.from({ length: 1000 }, (_, i) => `w${i}`);
    const chunks = chunkText(words.join(' '), 380, 48);
    expect(chunks.length).toBeGreaterThan(2);
    // overlap: chunk N+1 starts 332 words after chunk N
    expect(chunks[1]!.split(' ')[0]).toBe('w332');
    // coverage: last word present in final chunk
    expect(chunks.at(-1)!.split(' ').at(-1)).toBe('w999');
  });
});

describe('Embedder', () => {
  it(
    'produces normalized 384-dim deterministic vectors',
    async () => {
      const [a, b] = await embedder.embed(['the quick brown fox', 'the quick brown fox']);
      expect(a).toHaveLength(EMBEDDING_DIMS);
      const norm = Math.sqrt(a!.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1, 2);
      expect(Array.from(a!)).toEqual(Array.from(b!));
    },
    MODEL_TIMEOUT,
  );

  it(
    'recovers after a worker crash',
    async () => {
      await embedder.terminateForTest();
      expect(embedder.alive).toBe(false);
      const [v] = await embedder.embed(['recovery probe']);
      expect(v).toHaveLength(EMBEDDING_DIMS);
      expect(embedder.alive).toBe(true);
    },
    MODEL_TIMEOUT,
  );
});

describe('EpisodicStore', () => {
  it(
    'KNN round-trip: planted needle ranks first for its own text',
    async () => {
      const texts = [
        'Ben deadlifted 315 for a triple at RPE 8 on Tuesday',
        'The quokka is a small marsupial native to Western Australia',
        'Grocery list: eggs, oat milk, chicken thighs, spinach',
      ];
      const vectors = await embedder.embed(texts);
      texts.forEach((t, i) => store.insertChunk('journal', `test:${i}`, '2026-07-07', t, vectors[i]!));

      const [q] = await embedder.embed(['what marsupial did we discuss?']);
      const hits = store.searchChunks(q!, 2);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.text).toContain('quokka');
    },
    MODEL_TIMEOUT,
  );

  it(
    'indexText chunks and stores long documents',
    async () => {
      const long = Array.from({ length: 900 }, (_, i) => `token${i}`).join(' ');
      const ids = await store.indexText(embedder, 'document', 'doc:1', null, long);
      expect(ids.length).toBeGreaterThan(1);
    },
    MODEL_TIMEOUT,
  );

  it(
    'lesson search returns only active lessons',
    async () => {
      const [v1, v2] = await embedder.embed([
        'Always log Ben usual breakfast as three eggs and two toast',
        'Ben mood drops after three nights of short sleep',
      ]);
      const id1 = store.insertLesson('breakfast default', 'nutrition', 'obs', 0.9, v1!);
      store.insertLesson('sleep-mood link', 'mind', 'obs', 0.8, v2!);
      store.setLessonStatus(id1, 'retired');
      const [q] = await embedder.embed(['what is the usual breakfast?']);
      const hits = store.searchLessons(q!, 4);
      expect(hits.every((h) => h.status === 'active')).toBe(true);
      expect(hits.some((h) => h.text === 'breakfast default')).toBe(false);
    },
    MODEL_TIMEOUT,
  );

  it('rejects wrong-dimension vectors', () => {
    expect(() => store.insertChunk('journal', 'x', null, 'text', new Float32Array(10))).toThrow(/384/);
  });
});
