import { Page, PageHeader } from '@/components/page';
import { Ledger } from './jobs/Ledger';
import { Schedules } from './jobs/Schedules';
import { SystemJobs } from './jobs/SystemJobs';

export default function JobsPage() {
  return (
    <Page>
      <PageHeader title="Jobs" description="What runs on a schedule, and proof that it ran." />
      <Schedules />
      <SystemJobs />
      <Ledger />
    </Page>
  );
}
