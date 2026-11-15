import { useCallback, useState } from 'react';
import { act } from '@/lib/act';
import type { RecordInput, SpacePayload, SpaceRecord } from '@/lib/spaces';
import { useView, type ViewState } from '@/lib/useView';

type Patch = Partial<Pick<SpaceRecord, 'done' | 'data'>>;

export interface SpaceData {
  view: ViewState<SpacePayload>;
  records: SpaceRecord[];
  /** Writes records. `optimistic` changes show at once and give way to the server's answer. */
  update: (records: (RecordInput & { delete?: boolean })[], opts?: { success?: string }) => Promise<boolean>;
}

/**
 * A space and its records, with ticks and board moves applied on screen
 * before the server confirms them: a checkbox that waits on the network
 * feels broken on a phone.
 */
export function useSpace(slug: string): SpaceData {
  const view = useView<SpacePayload>('spaces/get', { space: slug });
  // Patches belong to the payload they were made against; a newer payload drops them.
  const [pending, setPending] = useState<{ base: SpacePayload | undefined; byId: Record<number, Patch> }>({ base: undefined, byId: {} });
  const byId = pending.base === view.data ? pending.byId : {};
  const records = (view.data?.records ?? []).map((r) => {
    const p = byId[r.id];
    return p ? { ...r, ...p, data: { ...r.data, ...(p.data ?? {}) } } : r;
  });

  const base = view.data;
  const update = useCallback<SpaceData['update']>(
    async (inputs, opts) => {
      const patch: Record<number, Patch> = {};
      for (const i of inputs) {
        if (i.id == null || i.delete) continue;
        const p: Patch = {};
        if (i.done !== undefined) p.done = i.done;
        if (i.data) p.data = i.data;
        patch[i.id] = p;
      }
      setPending((cur) => ({ base, byId: { ...(cur.base === base ? cur.byId : {}), ...patch } }));
      const r = await act('space_records_update', { space: slug, records: inputs }, opts);
      if (!r.ok) setPending({ base: undefined, byId: {} });
      return r.ok;
    },
    [slug, base],
  );

  return { view, records, update };
}
