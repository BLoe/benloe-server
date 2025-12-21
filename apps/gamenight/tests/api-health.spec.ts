import { test, expect } from '@playwright/test';

test.describe('API Health Checks', () => {
  test('API health endpoint should respond', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(body.status).toBe('healthy');
  });

  test('API games endpoint should respond', async ({ request }) => {
    const response = await request.get('/api/games');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('games');
    expect(Array.isArray(body.games)).toBe(true);
  });

  test('API events endpoint should respond', async ({ request }) => {
    const response = await request.get('/api/events');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('events');
    expect(Array.isArray(body.events)).toBe(true);
  });

  test('API should handle 404 gracefully', async ({ request }) => {
    const response = await request.get('/api/nonexistent-endpoint');

    expect(response.status()).toBe(404);
  });

  test('API should include security headers', async ({ request }) => {
    const response = await request.get('/api/health');

    // Check for important security headers
    expect(response.headers()['x-content-type-options']).toContain('nosniff');
    expect(response.headers()['x-frame-options']).toBeDefined();
    expect(response.headers()['content-security-policy']).toBeDefined();
  });

  test('API should enforce rate limiting headers', async ({ request }) => {
    const response = await request.get('/api/health');

    // Check for rate limiting headers
    expect(response.headers()['ratelimit-limit']).toBeDefined();
    expect(response.headers()['ratelimit-remaining']).toBeDefined();
  });
});
