// The preparer packet: the summary text and the archive around it.
import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Binaries tried in order: python3's zipfile, then zip, then tar (a .tar.gz). Tests swap names to force the fallbacks. */
export const archivers = { python: 'python3', zip: 'zip', tar: 'tar' };

const PY_ZIP = `
import os, sys, zipfile
stage, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(stage):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, stage))
`;

/**
 * Packs the folder `rootName` inside `stageDir` into `<outBase>.zip`, or
 * `<outBase>.tar.gz` when nothing on the box can write a zip. Returns the file written.
 */
export async function archive(stageDir: string, rootName: string, outBase: string): Promise<{ file: string; format: 'zip' | 'tar.gz' }> {
  const opts = { timeout: 120_000, env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' } };
  const zip = `${outBase}.zip`;
  const attempts: [() => Promise<unknown>, string, 'zip' | 'tar.gz'][] = [
    [() => run(archivers.python, ['-I', '-c', PY_ZIP, stageDir, zip], opts), zip, 'zip'],
    [() => run(archivers.zip, ['-r', '-q', zip, rootName], { ...opts, cwd: stageDir }), zip, 'zip'],
    [() => run(archivers.tar, ['-czf', `${outBase}.tar.gz`, '-C', stageDir, rootName], opts), `${outBase}.tar.gz`, 'tar.gz'],
  ];
  let last: unknown;
  for (const [attempt, file, format] of attempts) {
    try {
      await attempt();
      return { file, format };
    } catch (e) {
      last = e;
      rmSync(file, { force: true });
    }
  }
  throw new Error(`no archiver worked (python3, zip, tar): ${(last as Error)?.message ?? 'unknown error'}`);
}

export const CATEGORY_LABELS: Record<string, string> = {
  charity: 'Charitable giving', medical: 'Medical', state_local_tax: 'State and local taxes', mortgage_interest: 'Mortgage interest', business: 'Business',
  education: 'Education', retirement: 'Retirement contributions', hsa: 'HSA', childcare: 'Childcare', energy: 'Energy credits', payment: 'Tax payments', other: 'Other',
};

export const money = (n: number): string => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export interface PacketItem { label: string; form_type: string | null; status: string; document_id: number | null; notes: string | null }
export interface PacketDeduction { category: string; description: string; amount: number; date: string | null; document_id: number | null; notes: string | null }

const cell = (s: string | null | undefined): string => (s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

/** summary.md: what the preparer reads first. `files` maps a document id to its name inside the packet. */
export function summaryMarkdown(o: {
  year: number; builtOn: string; preparerNotes: string; items: PacketItem[]; deductions: PacketDeduction[]; files: Map<number, string>;
}): string {
  const fileOf = (id: number | null): string => (id == null ? '' : (o.files.get(id) ?? '(file unavailable)'));
  const received = o.items.filter((i) => i.status === 'received');
  const missing = o.items.filter((i) => i.status === 'expected');
  const na = o.items.filter((i) => i.status === 'not_applicable');
  const out: string[] = [`# ${o.year} tax packet`, '', `Prepared ${o.builtOn}. ${o.files.size} document file${o.files.size === 1 ? '' : 's'} included under \`documents/\`.`, ''];

  out.push('## Notes for the preparer', '', o.preparerNotes.trim() || '_None._', '');

  out.push('## Document checklist', '');
  if (!o.items.length) out.push('_No checklist items._', '');
  else {
    out.push(`${received.length} of ${received.length + missing.length} received, ${missing.length} still missing${na.length ? `, ${na.length} not applicable` : ''}.`, '');
    out.push('| Item | Form | Status | File | Notes |', '| --- | --- | --- | --- | --- |');
    const label = { received: 'Received', expected: 'MISSING', not_applicable: 'Not applicable' } as Record<string, string>;
    for (const i of o.items) out.push(`| ${cell(i.label)} | ${cell(i.form_type)} | ${label[i.status] ?? i.status} | ${cell(fileOf(i.document_id))} | ${cell(i.notes)} |`);
    out.push('');
    out.push('### Still missing', '');
    if (missing.length) for (const i of missing) out.push(`- ${i.label}${i.form_type ? ` (${i.form_type})` : ''}${i.notes ? `: ${cell(i.notes)}` : ''}`);
    else out.push('_Nothing: every expected document is in._');
    out.push('');
  }

  const table = (rows: PacketDeduction[]): void => {
    out.push('| Date | Description | Amount | File | Notes |', '| --- | --- | ---: | --- | --- |');
    for (const d of rows) out.push(`| ${d.date ?? ''} | ${cell(d.description)} | ${money(d.amount)} | ${cell(fileOf(d.document_id))} | ${cell(d.notes)} |`);
    out.push('');
  };
  const total = (rows: PacketDeduction[]): number => Math.round(rows.reduce((s, d) => s + d.amount, 0) * 100) / 100;
  const deductions = o.deductions.filter((d) => d.category !== 'payment');
  const payments = o.deductions.filter((d) => d.category === 'payment');

  out.push('## Deductions and tax-relevant items', '');
  if (!deductions.length) out.push('_None recorded._', '');
  else {
    for (const cat of [...new Set(deductions.map((d) => d.category))]) {
      const rows = deductions.filter((d) => d.category === cat);
      out.push(`### ${CATEGORY_LABELS[cat] ?? cat}: ${money(total(rows))}`, '');
      table(rows);
    }
    out.push(`**Total of all items above: ${money(total(deductions))}**`, '');
  }

  out.push('## Tax payments and withholding notes', '');
  if (!payments.length) out.push('_None recorded._', '');
  else {
    table(payments);
    out.push(`**Total payments: ${money(total(payments))}**`, '');
  }
  return out.join('\n');
}
