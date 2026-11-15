import { ChevronDown, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, Field, FieldRow, FormDialog, List, ListRow, Section } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, Select } from '@/components/ui/input';
import { act, useAct } from '@/lib/act';
import { money, plural } from '@/lib/format';
import { toast } from '@/lib/toast';
import { GROUP_LABELS, groupCategories, snake } from './logic';
import { CategorySelect, FormError, useMoney } from './shared';
import type { Category, Rule } from './types';

const GROUP_HINTS: Record<string, string> = { essentials: 'Spending you cannot easily skip.', lifestyle: 'Spending you choose.', income: 'Money in.', transfers: 'Neither spending nor income.' };

export function Categories() {
  const { categories, groups, rules, go, uncategorizedCount: uncategorized } = useMoney();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [addingRule, setAddingRule] = useState(false);
  const [removingRule, setRemovingRule] = useState<Rule | null>(null);
  const [filter, setFilter] = useState('');
  const { run, pending } = useAct();

  const reapply = async (scope: 'uncategorized' | 'all') => {
    const r = await run<{ reapplied: number }>('money_transactions_update', { reapply_rules: scope });
    if (r.ok) toast.success(r.result.reapplied ? `${plural(r.result.reapplied, 'transaction')} recategorized` : 'Nothing changed: every rule was already applied');
  };

  const needle = filter.trim().toLowerCase();
  const shownRules = needle ? rules.filter((r) => r.pattern.toLowerCase().includes(needle) || (r.category_label ?? '').toLowerCase().includes(needle) || (r.merchant ?? '').toLowerCase().includes(needle)) : rules;

  return (
    <div className="flex flex-col gap-7">
      {uncategorized > 0 && (
        <List>
          <ListRow onClick={() => go('transactions', { category: 'uncategorized' })} title={`${plural(uncategorized, 'transaction')} without a category`} meta="Fix" />
        </List>
      )}
      <Section
        title="Categories"
        action={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus />
            Add a category
          </Button>
        }
      >
        <div className="grid gap-4 @2xl/page:grid-cols-2">
          {groupCategories(categories, groups).map((g) => (
            <div key={g.group}>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">{g.label}</p>
              <List>
                {g.categories.map((c) => (
                  <ListRow
                    key={c.name}
                    onClick={() => setEditing(c)}
                    title={c.label}
                    subtitle={[c.transaction_count ? plural(c.transaction_count, 'transaction') : 'Unused', c.rule_count ? plural(c.rule_count, 'rule') : null].filter(Boolean).join(' · ')}
                    meta={c.budget != null ? `${money(c.budget, { cents: false })}/mo` : undefined}
                  />
                ))}
              </List>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Rules"
        description="Applied to every imported or added transaction that was not categorized by hand."
        action={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}>
                  Re-apply rules
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => void reapply('uncategorized')}>To uncategorized transactions</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void reapply('all')}>To everything not categorized by hand</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => setAddingRule(true)} aria-label="Add a rule">
              <Plus />
              <span className="hidden @lg/page:inline">Add a rule</span>
            </Button>
          </>
        }
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${plural(rules.length, 'rule')}`} aria-label="Filter rules" className="pl-9" />
        </div>
        {shownRules.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{rules.length ? 'No rule matches.' : 'No rules. Add one, or recategorize a transaction and tick “always”.'}</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {shownRules.map((r) => (
              <li key={r.id} className="flex min-h-14 items-center gap-3 py-2 pr-2 pl-4">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px]">{r.pattern}</span>
                    {r.match_type === 'regex' && <Badge variant="outline">regex</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {[r.category ? `→ ${r.category_label ?? r.category}` : null, r.merchant ? `shown as ${r.merchant}` : null, r.priority ? `priority ${r.priority}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove the rule ${r.pattern}`} onClick={() => setRemovingRule(r)}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {editing && <CategoryDialog category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {addingRule && <RuleDialog onClose={() => setAddingRule(false)} />}
      <ConfirmDialog
        open={!!removingRule}
        onOpenChange={(o) => !o && setRemovingRule(null)}
        title={`Remove the rule “${removingRule?.pattern ?? ''}”?`}
        body="Transactions it already categorized keep their category; new ones will not get it."
        confirmLabel="Remove rule"
        onConfirm={() => {
          const r = removingRule;
          setRemovingRule(null);
          if (r) void act('money_transactions_update', { rules: [{ pattern: r.pattern, match: r.match_type, remove: true }] }, { success: 'Rule removed' });
        }}
      />
    </div>
  );
}

function CategoryDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const { categories, groups } = useMoney();
  const [label, setLabel] = useState(category?.label ?? '');
  const [group, setGroup] = useState(category?.group ?? 'lifestyle');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const { run, pending } = useAct();
  const fixed = category?.name === 'transfer';

  const submit = async () => {
    const text = label.trim();
    const key = snake(text);
    if (key.length < 2 || key === 'uncategorized') return setError('Give it a name of at least two letters.');
    if (!category) {
      if (categories.some((c) => c.name === key)) return setError(`There is already a category “${categories.find((c) => c.name === key)!.label}”.`);
      const r = await run('money_budget_update', { categories: [{ name: key, label: text, group }] }, { success: `${text} added` });
      if (r.ok) onClose();
      return;
    }
    if (text === category.label && group === category.group) return onClose();
    // The key Kevin queries by follows the label, so the two never drift apart. 'transfer' is the one key the server depends on.
    const rename = !fixed && key !== category.name && !categories.some((c) => c.name === key);
    const r = await run('money_budget_update', { categories: [{ name: category.name, label: text, group, ...(rename ? { rename_to: key } : {}) }] }, { success: 'Saved' });
    if (r.ok) onClose();
  };

  return (
    <>
      <FormDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={category ? 'Edit category' : 'Add a category'}
        submitLabel={category ? 'Save' : 'Add category'}
        pending={pending}
        onSubmit={() => void submit()}
        extraAction={
          category &&
          !fixed && (
            <Button variant="ghost" className="w-full text-destructive lg:w-auto" onClick={() => setRemoving(true)}>
              <Trash2 />
              Remove
            </Button>
          )
        }
      >
        <FieldRow>
          <Field label="Name">{(id) => <Input id={id} value={label} maxLength={40} placeholder="Kids activities" onChange={(e) => setLabel(e.target.value)} autoFocus={!category} />}</Field>
          <Field label="Group" hint={fixed ? 'Marking a transaction as a transfer uses this category, so it stays here.' : GROUP_HINTS[group]}>
            {(id) => (
              <Select id={id} value={group} disabled={fixed} onChange={(e) => setGroup(e.target.value)}>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABELS[g] ?? g}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FieldRow>
        {category && category.budget != null && group !== category.group && (group === 'income' || group === 'transfers') && (
          <p className="text-sm text-warning">Its {money(category.budget, { cents: false })} budget will be removed: budgets are for spending categories.</p>
        )}
        <FormError>{error}</FormError>
      </FormDialog>
      {category && removing && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setRemoving(false)}
          title={`Remove ${category.label}?`}
          description={`${category.transaction_count ? `${plural(category.transaction_count, 'transaction')} ${category.transaction_count === 1 ? 'uses' : 'use'} it` : 'No transactions use it'}${category.rule_count ? `, and ${plural(category.rule_count, 'rule')}` : ''}${category.budget != null ? '. Its budget goes with it' : ''}.`}
          submitLabel="Remove category"
          pending={pending}
          onSubmit={() =>
            void run('money_budget_update', { categories: [{ name: category.name, remove: true, ...(moveTo ? { move_to: moveTo } : {}) }] }, { success: `${category.label} removed` }).then((r) => {
              if (r.ok) onClose();
            })
          }
        >
          {(category.transaction_count > 0 || category.rule_count > 0) && (
            <Field label="Move its transactions and rules to" hint={moveTo ? undefined : 'Left as is, its transactions become uncategorized and its rules are deleted.'}>
              {(id) => <CategorySelect id={id} value={moveTo} onChange={setMoveTo} none="Nowhere: leave them uncategorized" exclude={[category.name]} />}
            </Field>
          )}
        </FormDialog>
      )}
    </>
  );
}

function RuleDialog({ onClose }: { onClose: () => void }) {
  const [pattern, setPattern] = useState('');
  const [match, setMatch] = useState<'contains' | 'regex'>('contains');
  const [category, setCategory] = useState('');
  const [merchant, setMerchant] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, pending } = useAct();
  const submit = async () => {
    const p = pattern.trim();
    if (p.length < 2) return setError('Enter at least two characters to look for.');
    if (!category && !merchant.trim()) return setError('Choose a category, a merchant name to show, or both.');
    if (match === 'regex') {
      try {
        new RegExp(p, 'i');
      } catch {
        return setError('That is not a valid regular expression.');
      }
    }
    const r = await run<{ rules_applied_to?: number }>('money_transactions_update', { rules: [{ pattern: p, match, ...(category ? { category } : {}), ...(merchant.trim() ? { merchant: merchant.trim() } : {}) }] }, { silent: true });
    if (!r.ok) return setError(r.error);
    toast.success('Rule added', r.result.rules_applied_to ? `${plural(r.result.rules_applied_to, 'existing transaction')} updated` : undefined);
    onClose();
  };
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Add a rule" description="It also applies now to existing transactions that were not categorized by hand." submitLabel="Add rule" pending={pending} onSubmit={() => void submit()}>
      <FieldRow>
        <Field label="When the description has" hint={match === 'regex' ? 'A regular expression, e.g. \\bshell\\b' : 'Case does not matter: trader joe'}>
          {(id) => <Input id={id} value={pattern} maxLength={200} autoCapitalize="off" autoCorrect="off" onChange={(e) => setPattern(e.target.value)} autoFocus />}
        </Field>
        <Field label="Match">
          {(id) => (
            <Select id={id} value={match} onChange={(e) => setMatch(e.target.value as 'contains' | 'regex')}>
              <option value="contains">Contains the text</option>
              <option value="regex">Regular expression</option>
            </Select>
          )}
        </Field>
      </FieldRow>
      <Field label="Categorize as">{(id) => <CategorySelect id={id} value={category} onChange={setCategory} none="Leave the category alone" />}</Field>
      <Field label="Show the merchant as" hint="Optional: a clean name in place of the bank's text.">
        {(id) => <Input id={id} value={merchant} maxLength={80} onChange={(e) => setMerchant(e.target.value)} />}
      </Field>
      <FormError>{error}</FormError>
    </FormDialog>
  );
}
