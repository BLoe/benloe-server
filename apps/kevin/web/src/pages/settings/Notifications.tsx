import { BellRing, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Section } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import { currentSubscription, enablePush, pushSupport, sendTestPush } from '@/lib/push';
import { toast } from '@/lib/toast';
import type { Health } from '@/lib/types';
import { useView } from '@/lib/useView';

export function Notifications() {
  const me = useMe();
  const health = useView<Health>('system/health');
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const support = me ? pushSupport(me.vapidPublicKey) : null;

  useEffect(() => {
    let live = true;
    if (support?.state !== 'ready') return;
    currentSubscription().then(
      (s) => live && setSubscribed(!!s && Notification.permission === 'granted'),
      () => live && setSubscribed(false),
    );
    return () => {
      live = false;
    };
  }, [support?.state]);

  const enable = async () => {
    if (!me) return;
    setBusy(true);
    try {
      await enablePush(me.vapidPublicKey);
      setSubscribed(true);
      health.refetch();
      toast.success('Notifications are on for this device');
    } catch (e) {
      toast.error('Couldn’t turn on notifications', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await sendTestPush();
      if (r.pushed > 0) toast.success(`Test sent to ${plural(r.pushed, 'device')}`);
      else toast.info('The test is in your inbox, but no device accepted a push', { body: 'Turn on notifications on a device first.' });
    } catch (e) {
      toast.error('Test not sent', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Push notifications" description="Reminders and alerts on this device’s lock screen, even when Kevin is closed.">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <BellRing className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              This device
              {support?.state === 'ready' && subscribed != null && <Badge variant={subscribed ? 'success' : 'neutral'}>{subscribed ? 'On' : 'Off'}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {!support && 'Checking…'}
              {support?.state === 'ready' && (subscribed ? 'Kevin can reach you here.' : 'Your browser will ask for permission.')}
              {support?.state === 'needs-install' && 'On iPhone and iPad, notifications only work once Kevin is on your Home Screen.'}
              {support?.state === 'denied' && 'Notifications are blocked for Kevin in this browser. Allow them in the browser’s site settings, then come back.'}
              {support?.state === 'unsupported' && 'This browser does not support push notifications.'}
              {support?.state === 'no-key' && 'The server has no push keys configured (KEVIN_VAPID_* in the kevin secret set).'}
            </p>
          </div>
        </div>

        {support?.state === 'needs-install' && (
          <ol className="list-decimal space-y-1.5 rounded-lg bg-muted py-3 pr-4 pl-9 text-sm">
            <li>
              In Safari, tap the Share button <Share className="inline size-4 align-text-bottom" aria-label="(a square with an arrow pointing up)" />.
            </li>
            <li>Choose “Add to Home Screen”.</li>
            <li>Open Kevin from the Home Screen and come back to this page.</li>
          </ol>
        )}

        {support?.state === 'ready' && (
          <div className="flex flex-col gap-2 @lg/page:flex-row">
            {!subscribed && (
              <Button onClick={() => void enable()} disabled={busy || subscribed === null}>
                Turn on notifications
              </Button>
            )}
            <Button variant="outline" onClick={() => void test()} disabled={busy}>
              Send a test notification
            </Button>
          </div>
        )}

        <p className="border-t pt-3 text-sm text-muted-foreground">
          {health.data ? `${plural(health.data.push_devices, 'device')} signed up for push in total.` : ' '} Every notification also lands in the inbox behind the bell.
        </p>
      </div>
    </Section>
  );
}
