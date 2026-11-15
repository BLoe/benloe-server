import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, Field, FormDialog } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { act } from '@/lib/act';
import { plural } from '@/lib/format';
import { toast } from '@/lib/toast';
import { labelsOf, type LogEntry, type MealResult } from './logic';
import { StarInput } from './parts';

/** After "I made this": what the cook log says and exactly what left the pantry. */
function Logged({ result, onClose }: { result: MealResult; onClose: () => void }) {
  // The server reports an ingredient it found but could not subtract (2 slices from 1 loaf) as "unchanged" with the reason in its note.
  const all = result.pantry?.changed ?? [];
  const changed = all.filter((c) => c.did !== 'unchanged');
  const skipped = [...all.filter((c) => c.did === 'unchanged').map((c) => ({ name: c.name, reason: c.note ?? 'The amount on record could not be changed.' })), ...(result.pantry?.not_applied ?? [])];
  const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1).replace(/[.;]?$/, '.');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Logged {result.entry?.dish}</DialogTitle>
          <DialogDescription>{result.times_cooked ? `You’ve cooked this ${result.times_cooked === 1 ? 'once' : `${result.times_cooked} times`}.` : 'It’s in the cook log.'}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 pt-1">
          {changed.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Taken out of the pantry</h3>
              <ul className="divide-y rounded-lg border" data-testid="deducted">
                {changed.map((c) => (
                  <li key={c.name} className="px-3 py-2">
                    <span className="font-medium break-words">{c.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {c.did === 'ran_out' ? 'Used up. It’s under Out of stock now.' : `Left: ${c.now.replace(/, expires.*/, '')}.`}
                      {c.note && ` ${sentence(c.note)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {skipped.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Not taken out</h3>
              <ul className="divide-y rounded-lg border" data-testid="not-deducted">
                {skipped.map((s) => (
                  <li key={s.name} className="px-3 py-2">
                    <span className="font-medium break-words">{s.name}</span>
                    <span className="block text-sm text-muted-foreground">{sentence(s.reason)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {result.pantry && !changed.length && !skipped.length && <p className="text-sm text-muted-foreground">Nothing in the recipe had an amount to take out of the pantry.</p>}
          {!result.pantry && <p className="text-sm text-muted-foreground">The pantry was left as it is.</p>}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Logs a meal or corrects a log entry. With `recipe` it is the "I made this"
 * sheet: rating, notes, and a switch (on by default) that takes the recipe's
 * ingredients out of the pantry, followed by what was taken. Without one it
 * logs a dish by name. With `entry` it edits or deletes that entry.
 */
export function MealSheet({ recipe, entry, today, onClose, onLogged }: { recipe?: { id: number; title: string }; entry?: LogEntry; today: string; onClose: () => void; /** Called once a new meal is in the log, before the sheet closes. */ onLogged?: () => void }) {
  const [dish, setDish] = useState(entry?.dish ?? '');
  const [day, setDay] = useState(entry?.cooked_on ?? today);
  const [rating, setRating] = useState<number | null>(entry?.rating ?? null);
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [techniques, setTechniques] = useState('');
  const [deduct, setDeduct] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<MealResult | null>(null);

  const save = async () => {
    setSaving(true);
    let input: Record<string, unknown>;
    if (entry) {
      input = { id: entry.id, cooked_on: day, rating, notes: notes.trim() || null, ...(entry.recipe_id == null && dish.trim() !== entry.dish ? { dish: dish.trim() } : {}) };
    } else {
      input = {
        ...(recipe ? { recipe_id: recipe.id, deduct_recipe_ingredients: deduct } : { dish: dish.trim(), ...(labelsOf(techniques).length ? { techniques: labelsOf(techniques) } : {}) }),
        cooked_on: day,
        ...(rating != null ? { rating } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
    }
    const r = await act<MealResult>('cooking_log_meal', input);
    setSaving(false);
    if (!r.ok) return;
    if (!entry) onLogged?.();
    if (recipe && !entry) return setResult(r.result);
    toast.success(entry ? 'Saved' : `Logged ${r.result.entry?.dish ?? dish}`, r.result.entry?.recipe_id != null && !entry ? 'Linked to your saved recipe.' : undefined);
    onClose();
  };

  if (result) return <Logged result={result} onClose={onClose} />;

  return (
    <>
      <FormDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={entry ? 'Edit cook log entry' : recipe ? 'I made this' : 'Log a meal'}
        description={recipe?.title ?? (entry && entry.recipe_id != null ? entry.dish : undefined)}
        submitLabel={entry ? 'Save' : 'Log it'}
        pending={saving}
        canSubmit={!!day && (!!recipe || !!dish.trim() || (!!entry && entry.recipe_id != null))}
        onSubmit={() => void save()}
        extraAction={
          entry && (
            <Button variant="ghost" className="w-full text-destructive lg:w-auto" onClick={() => setDeleting(true)}>
              <Trash2 />
              Delete
            </Button>
          )
        }
      >
        {!recipe && !(entry && entry.recipe_id != null) && (
          <Field label="What did you cook?" hint={entry ? undefined : 'If it matches a saved recipe, the entry is linked to it.'}>
            {(id) => <Input id={id} value={dish} maxLength={200} autoFocus={!entry} placeholder="Grilled cheese" onChange={(e) => setDish(e.target.value)} />}
          </Field>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">How was it?</span>
          <StarInput value={rating} onChange={setRating} />
        </div>
        <Field label="Notes" hint="How it went, what you changed, what to do differently.">
          {(id) => <Textarea id={id} value={notes} rows={3} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <Field label="Cooked on">{(id) => <Input id={id} type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />}</Field>
        {!recipe && !entry && (
          <Field label="Techniques practised" hint="Optional, comma-separated: searing, knife work. They count towards Skills.">
            {(id) => <Input id={id} value={techniques} autoCapitalize="none" onChange={(e) => setTechniques(e.target.value)} />}
          </Field>
        )}
        {recipe && !entry && (
          <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3">
            <span>
              <span className="block font-medium">Take the ingredients out of the pantry</span>
              <span className="block text-sm text-muted-foreground">Subtracts the recipe’s amounts and shows you what changed.</span>
            </span>
            <Switch checked={deduct} onCheckedChange={setDeduct} aria-label="Take the ingredients out of the pantry" />
          </label>
        )}
      </FormDialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete this entry for ${entry?.dish ?? ''}?`}
        body={`The cook log loses it and Skills counts ${plural(entry?.techniques.length ?? 0, 'technique')} less. The pantry is not changed.`}
        confirmLabel="Delete entry"
        onConfirm={() => {
          if (entry) void act('cooking_log_meal', { id: entry.id, delete: true }, { success: 'Deleted' });
          onClose();
        }}
      />
    </>
  );
}
