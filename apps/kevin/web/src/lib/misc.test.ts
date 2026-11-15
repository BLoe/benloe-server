import { describe, expect, it } from 'vitest';
import { query } from './api';
import { fitWithin, jpegName } from './image';
import { isIos, vapidKeyBytes } from './push';
import { staleDomains, viewUrl } from './useView';
import { inputSummary } from '../components/chat/ToolRow';
import { fillDays } from '../pages/settings/DailyBars';

describe('image downscaling', () => {
  it('leaves images within the limit alone', () => {
    expect(fitWithin(1600, 1200)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(2000, 2000)).toEqual({ width: 2000, height: 2000 });
  });
  it('scales the long side to 2000 and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(10_000, 10)).toEqual({ width: 2000, height: 2 });
    expect(fitWithin(30_000, 10)).toEqual({ width: 2000, height: 1 });
  });
  it('renames to .jpg', () => {
    expect(jpegName('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
    expect(jpegName('fridge.photo.png')).toBe('fridge.photo.jpg');
    expect(jpegName('noext')).toBe('noext.jpg');
    expect(jpegName('')).toBe('photo.jpg');
  });
});

describe('view plumbing', () => {
  it('builds view URLs, dropping empty params', () => {
    expect(viewUrl('pantry/items')).toBe('/view/pantry/items');
    expect(viewUrl('pantry/items', { location: 'fridge', q: '', limit: 20, idle: true, off: false, none: null })).toBe('/view/pantry/items?location=fridge&limit=20&idle=1');
    expect(query({ q: 'a b&c' })).toBe('?q=a+b%26c');
  });
  it('maps events to the domains they make stale', () => {
    expect(staleDomains({ type: 'data_changed', domains: ['pantry', 'cooking'] })).toEqual(['pantry', 'cooking']);
    expect(staleDomains({ type: 'notification', id: 1, at: '', title: '', body: '', link: null, source: null })).toEqual([]);
    expect(staleDomains({ type: 'turn_end', threadId: 't', turnId: 1, status: 'done', costUsd: 0 })).toEqual(['system']);
    expect(staleDomains({ type: 'reconnected' })).toBe('all');
    expect(staleDomains({ type: 'text_delta', threadId: 't', turnId: 1, text: 'x' })).toEqual([]);
  });
});

describe('push helpers', () => {
  it('decodes a URL-safe base64 VAPID key', () => {
    expect([...vapidKeyBytes('AQID-_8')]).toEqual([1, 2, 3, 251, 255]);
  });
  it('recognises iPhones and iPads (which claim to be Macs)', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 15)', 5)).toBe(false);
  });
});

describe('small display helpers', () => {
  it('summarises a tool input by its first meaningful value', () => {
    expect(inputSummary({ text: 'Ben  likes\ntea', category: 'food' })).toBe('Ben likes tea');
    expect(inputSummary({ id: 4, delete: true })).toBe('4');
    expect(inputSummary({})).toBe('');
    expect(inputSummary(null)).toBe('');
  });
  it('fills missing days with zero', () => {
    const days = fillDays([{ day: '2026-11-13', cost_usd: 1.5 }], new Date('2026-11-14T10:00:00Z'), 3);
    expect(days).toEqual([
      { day: '2026-11-12', cost_usd: 0 },
      { day: '2026-11-13', cost_usd: 1.5 },
      { day: '2026-11-14', cost_usd: 0 },
    ]);
  });
});
