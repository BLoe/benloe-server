import { act } from './act';
import type { NotificationsView } from './types';
import { useView, type ViewState } from './useView';

/** The inbox. Refetches itself when a notification arrives or one is marked read (both publish data_changed for `system`). */
export function useNotifications(limit = 30): ViewState<NotificationsView> {
  return useView<NotificationsView>('system/notifications', { limit });
}

/** Marks these read, or everything when `ids` is omitted. */
export function markRead(ids?: number[]): void {
  void act('notifications_read', ids ? { ids } : {}, { silent: true });
}
