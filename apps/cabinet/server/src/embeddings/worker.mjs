// Embedding child process (plain JS so it runs identically from src/ and dist/).
// A child process — not a worker thread — because onnxruntime-node's native
// binding cannot be loaded twice within one process, which would make crash
// recovery impossible. IPC uses serialization:'advanced' (structured clone).
// Loads Xenova/bge-small-en-v1.5 (384-dim) via @huggingface/transformers on CPU.
import { env, pipeline } from '@huggingface/transformers';

env.cacheDir = process.env.CABINET_MODELS_DIR || '/srv/benloe/data/cabinet/models';
env.allowLocalModels = true;

const MODEL = 'Xenova/bge-small-en-v1.5';
let extractorPromise = null;

function getExtractor() {
  extractorPromise ??= pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  return extractorPromise;
}

process.on('message', async ({ id, texts }) => {
  try {
    const extractor = await getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const dims = output.dims.at(-1);
    const flat = output.data;
    const vectors = [];
    for (let i = 0; i < texts.length; i++) {
      vectors.push(new Float32Array(flat.slice(i * dims, (i + 1) * dims)));
    }
    process.send({ id, dims, vectors });
  } catch (err) {
    process.send({ id, error: String(err?.message ?? err) });
  }
});

process.send({ ready: true });
