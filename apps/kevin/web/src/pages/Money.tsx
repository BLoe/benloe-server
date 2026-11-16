// Money: accounts, transactions, budgets and holdings. One page, nine tabs held
// in the URL (?tab=transactions&category=dining&month=2026-10) so a jump from a
// number to the transactions behind it is a link and the back button undoes it.
import { Upload } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AskKevin, ErrorState, LoadingRows, Page, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { localDay } from '@/lib/format';
import { useMe, useNow } from '@/lib/hooks';
import { useView } from '@/lib/useView';
import { AccountDialog, Accounts } from './money/Accounts';
import { Budgets } from './money/Budgets';
import { Categories } from './money/Categories';
import { Holdings } from './money/Holdings';
import { ImportFlow } from './money/ImportFlow';
import { Imports } from './money/Imports';
import { Overview } from './money/Overview';
import { Recurring } from './money/Recurring';
import { Spending } from './money/Spending';
import { Transactions } from './money/Transactions';
import { searchFor, TAB_LABELS, tabOf, TABS, type Tab, type TxFilter } from './money/logic';
import { MoneyProvider, type MoneyData } from './money/shared';
import type { AccountsView, CategoriesView } from './money/types';

export default function MoneyPage() {
  const [params, setParams] = useSearchParams();
  const tab = tabOf(params.get('tab'));
  const me = useMe();
  const now = useNow(60_000);
  const today = localDay(now, me?.timezone);
  // Categories and accounts feed pickers on every tab, so they are read once here.
  const categories = useView<CategoriesView>('money/categories');
  const accounts = useView<AccountsView>('money/accounts', { include_inactive: 1 });
  const [importing, setImporting] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);

  const go = useCallback((to: Tab, filter?: Partial<TxFilter>) => setParams(searchFor(to, filter)), [setParams]);
  const openImport = useCallback(() => setImporting(true), []);
  const openNewAccount = useCallback(() => setAddingAccount(true), []);

  const data = useMemo<MoneyData | null>(
    () =>
      categories.data && accounts.data
        ? { today, categories: categories.data.categories, groups: categories.data.groups, rules: categories.data.rules, uncategorizedCount: categories.data.uncategorized_count, accounts: accounts.data.accounts, go, openImport, openNewAccount }
        : null,
    [today, categories.data, accounts.data, go, openImport, openNewAccount],
  );

  const header = (
    <PageHeader
      title="Money"
      actions={
        <>
          <Button variant="outline" onClick={openImport}>
            <Upload />
            Import CSV
          </Button>
          <AskKevin prompt="About my money: " prefill>
            Ask Kevin
          </AskKevin>
        </>
      }
    />
  );

  if (!data) {
    const error = categories.error ?? accounts.error;
    return (
      <Page wide>
        {header}
        {error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              categories.refetch();
              accounts.refetch();
            }}
          />
        ) : (
          <LoadingRows rows={4} />
        )}
      </Page>
    );
  }

  return (
    <MoneyProvider value={data}>
      <Page wide>
        {header}
        <Tabs value={tab} onValueChange={(t) => setParams(searchFor(tabOf(t)), { replace: true })}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview">
            <Overview />
          </TabsContent>
          <TabsContent value="transactions">
            <Transactions />
          </TabsContent>
          <TabsContent value="budgets">
            <Budgets />
          </TabsContent>
          <TabsContent value="spending">
            <Spending />
          </TabsContent>
          <TabsContent value="recurring">
            <Recurring />
          </TabsContent>
          <TabsContent value="accounts">
            <Accounts />
          </TabsContent>
          <TabsContent value="holdings">
            <Holdings />
          </TabsContent>
          <TabsContent value="categories">
            <Categories />
          </TabsContent>
          <TabsContent value="imports">
            <Imports />
          </TabsContent>
        </Tabs>
        {importing && <ImportFlow onClose={() => setImporting(false)} />}
        {addingAccount && <AccountDialog account={null} onClose={() => setAddingAccount(false)} />}
      </Page>
    </MoneyProvider>
  );
}
