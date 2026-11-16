import { useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Memory } from './settings/Memory';
import { Navigation } from './settings/Navigation';
import { Notifications } from './settings/Notifications';
import { Spend } from './settings/Spend';
import { System } from './settings/System';

const TABS = ['spend', 'memory', 'navigation', 'notifications', 'system'] as const;

export default function SettingsPage() {
  // The tab lives in the URL so a link (and the back button) can land on it.
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t === params.get('tab')) ?? 'spend';
  return (
    <Page>
      <PageHeader title="Settings" />
      <Tabs value={tab} onValueChange={(t) => setParams(t === 'spend' ? {} : { tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="spend">Spend</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="navigation">Navigation</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>
        <TabsContent value="spend">
          <Spend />
        </TabsContent>
        <TabsContent value="memory">
          <Memory />
        </TabsContent>
        <TabsContent value="navigation">
          <Navigation />
        </TabsContent>
        <TabsContent value="notifications">
          <Notifications />
        </TabsContent>
        <TabsContent value="system">
          <System />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
