import { CircleAlert, Download, FileText, Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { List, ListRow, Section } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useAct } from '@/lib/act';
import { bytes, dateTime, plural } from '@/lib/format';
import { useMe, useNow } from '@/lib/hooks';
import { documentLink } from '../documents/logic';
import { packetContents, type BuildResult, type YearDetail } from './logic';

/** What Ben wants the preparer to know. Saved with tax_checklist_update; printed at the top of the packet. */
export function PreparerNotes({ detail, year }: { detail: YearDetail; year: number }) {
  const [text, setText] = useState(detail.preparer_notes);
  const [base, setBase] = useState(detail.preparer_notes);
  const { run, pending } = useAct();
  const dirty = text !== base;
  // Kevin (or another tab) changed the notes: follow, unless Ben is mid-edit here.
  useEffect(() => {
    if (detail.preparer_notes === base) return;
    if (!dirty) setText(detail.preparer_notes);
    setBase(detail.preparer_notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.preparer_notes]);
  const save = async () => {
    const r = await run('tax_checklist_update', { year, preparer_notes: text }, { success: 'Notes saved' });
    if (r.ok) {
      setBase(text.trim());
      setText(text.trim());
    }
  };
  return (
    <Section title="Notes for the preparer" description="Anything they should know: a move, a new job, a sale, questions. Printed at the top of the packet.">
      <Textarea value={text} rows={5} maxLength={20_000} aria-label="Notes for the preparer" placeholder="e.g. Changed jobs in June. Sold the Honda in March. Is the home office deductible this year?" onChange={(e) => setText(e.target.value)} />
      {dirty && (
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={pending}>
            {pending ? 'Saving…' : 'Save notes'}
          </Button>
          <Button variant="outline" onClick={() => setText(base)} disabled={pending}>
            Discard
          </Button>
        </div>
      )}
    </Section>
  );
}

const SHOWN = 6;

/** Build the archive for the preparer, see what it will hold and what is still missing, and download it. */
export function PacketSection({ detail, year }: { detail: YearDetail; year: number }) {
  const { run, pending } = useAct();
  const [built, setBuilt] = useState<BuildResult | null>(null);
  const [all, setAll] = useState(false);
  const me = useMe();
  const now = useNow();
  const { documents, missing } = packetContents(detail);
  const shown = all ? documents : documents.slice(0, SHOWN);

  const build = async () => {
    const r = await run<BuildResult>('tax_packet_build', { year }, { success: 'Packet built' });
    if (r.ok) setBuilt(r.result);
  };
  // A result belongs to the year it was built for.
  const result = built && built.year === year ? built : null;

  return (
    <Section title="Packet for the preparer" description="One zip: a summary of the checklist, deductions, payments and your notes, plus a copy of every linked document.">
      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3.5">
        <div>
          <p className="font-medium">{documents.length ? `It will hold summary.md and ${plural(documents.length, 'document')}` : 'It will hold summary.md only'}</p>
          {documents.length === 0 ? (
            <p className="mt-0.5 text-sm text-muted-foreground">No document is linked to a checklist item or a deduction yet. Link them and their files are included.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-sm">
              {shown.map((d) => (
                <li key={d.id}>
                  <Link to={documentLink(d.id)} className="flex min-h-8 items-center gap-2 rounded-md text-muted-foreground hover:text-foreground">
                    <FileText className="size-4 shrink-0" />
                    <span className="min-w-0 break-words">{d.title}</span>
                  </Link>
                </li>
              ))}
              {documents.length > shown.length && (
                <li>
                  <button type="button" className="min-h-8 font-medium text-primary" onClick={() => setAll(true)}>
                    and {documents.length - shown.length} more
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
        {missing.length > 0 && (
          <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <span className="min-w-0 break-words">
              <span className="font-medium">Still missing ({missing.length}):</span> {missing.join(', ')}. You can build it now; the summary lists them as missing.
            </span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void build()} disabled={pending}>
            <Package />
            {pending ? 'Building…' : detail.packets.length ? 'Build a new packet' : 'Build packet'}
          </Button>
        </div>
        {result && (
          <div role="status" className="flex flex-col gap-2 rounded-lg bg-success-soft px-3 py-2.5 text-sm">
            <p className="break-words">
              <span className="font-medium">Built {result.filename}</span> <span className="tabular">({bytes(result.size_bytes)})</span>: the summary and {plural(result.file_count, 'document')}
              {result.missing_count ? `, with ${plural(result.missing_count, 'item')} still missing (${result.missing.join(', ')})` : ', nothing missing'}.
              {result.files_unavailable?.length ? ` Files that could not be included: ${result.files_unavailable.join(', ')}.` : ''}
            </p>
            <Button asChild className="self-start">
              <a href={result.download_url} download={result.filename}>
                <Download />
                Download the packet
              </a>
            </Button>
          </div>
        )}
      </div>

      {detail.packets.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="px-1 pt-1.5 text-sm font-medium text-muted-foreground">Packets built</h3>
          <List>
            {detail.packets.map((p, i) => (
              <ListRow
                key={p.id}
                wrap
                title={
                  <span>
                    {dateTime(p.created_at, now, me?.timezone)}
                    {i === 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">Latest</span>}
                  </span>
                }
                subtitle={<span className="tabular">{[plural(p.file_count, 'document'), p.missing_count ? `${p.missing_count} missing` : 'nothing missing', bytes(p.size_bytes), p.format].join(' · ')}</span>}
                trailing={
                  <Button asChild variant="outline" size="sm">
                    <a href={p.file_url} download={p.filename} aria-label={`Download the packet built ${dateTime(p.created_at, now, me?.timezone)}`}>
                      <Download />
                      Download
                    </a>
                  </Button>
                }
              />
            ))}
          </List>
        </div>
      )}
    </Section>
  );
}
