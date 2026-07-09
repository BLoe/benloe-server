/* The one import surfaces use: `api` (the real, Artanis-walled client) + all
   contract types.

   The mock is a DEV-ONLY convenience for building the UI without a logged-in
   backend. It can never ship: `import.meta.env.DEV` is false in any build, so
   the mock branch is dead-code-eliminated and production always uses fetchApi.
   In dev, mock is on by default; run with VITE_CABINET_MOCK=false to develop
   against the real gateway. */
import type { CabinetApi } from './contracts.js';
import { mockApi } from './mock.js';
import { fetchApi } from './client.js';

export * from './contracts.js';

const env = (import.meta as unknown as { env?: { DEV?: boolean; VITE_CABINET_MOCK?: string } }).env;
const USE_MOCK = !!env?.DEV && env?.VITE_CABINET_MOCK !== 'false';

export const api: CabinetApi = USE_MOCK ? mockApi : fetchApi;
export const usingMock = USE_MOCK;
