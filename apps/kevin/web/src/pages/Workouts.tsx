import { MessageCircle } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { openChat } from '@/lib/chat';
import { localDay } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import { History } from './workouts/History';
import { isDate } from './workouts/logic';
import { Plan } from './workouts/Plan';
import { Progress } from './workouts/Progress';
import { Today } from './workouts/Today';
import { Week } from './workouts/Week';

const TABS = ['today', 'week', 'plan', 'history', 'progress'] as const;
type Tab = (typeof TABS)[number];

/**
 * /workouts. The tab and what it is showing (a date, a week, a plan being
 * edited, an exercise) live in the URL, so back works and a link lands where
 * it should: ?tab=week&start=2026-11-09, ?tab=plan&edit=3, ?date=2026-11-12.
 */
export default function WorkoutsPage() {
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'today';
  // Calendar dates are in Ben's timezone, which is not always the browser's.
  const today = localDay(new Date(), me?.timezone);
  const go = (to: string, extra?: Record<string, string>) => setParams({ ...(to === 'today' ? {} : { tab: to }), ...extra }, { replace: to === tab });
  const date = params.get('date');
  const start = params.get('start');
  const num = (key: string) => {
    const n = Number(params.get(key));
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  return (
    <Page>
      <PageHeader
        title="Workouts"
        actions={
          <Button variant="outline" onClick={() => openChat({ prefill: tab === 'today' ? 'Log a workout: ' : '' })}>
            <MessageCircle />
            Ask Kevin
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(t) => go(t)}>
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          <Today key={date ?? 'today'} date={isDate(date) && date !== today ? date : null} today={today} go={go} />
        </TabsContent>
        <TabsContent value="week">
          <Week start={isDate(start) ? start : null} go={go} />
        </TabsContent>
        <TabsContent value="plan">
          <Plan edit={params.get('edit')} today={today} go={go} />
        </TabsContent>
        <TabsContent value="history">
          <History offset={num('offset') ?? 0} today={today} go={go} />
        </TabsContent>
        <TabsContent value="progress">
          <Progress exercise={num('exercise')} today={today} go={go} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
