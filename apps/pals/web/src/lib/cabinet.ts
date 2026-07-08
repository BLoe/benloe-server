/* The one import surfaces use: `api` (mock now, real when A11 lands) + all
   contract types. Flip to the real client with VITE_CABINET_MOCK=false. */
import type { CabinetApi } from './contracts.js';
import { mockApi } from './mock.js';
import { fetchApi } from './client.js';

export * from './contracts.js';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const USE_MOCK = (env?.VITE_CABINET_MOCK ?? 'true') !== 'false';

export const api: CabinetApi = USE_MOCK ? mockApi : fetchApi;
export const usingMock = USE_MOCK;
