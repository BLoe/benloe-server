import { Router } from 'express';

import { authService } from '../services/auth';

const router = Router();

// Everything here is admin-only (authenticate runs upstream in server.ts).
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  next();
});

// List every agent key (hints only — raw keys are never stored).
router.get('/agents', async (_req, res) => {
  const keys = await authService.listAgentKeys();
  res.json({
    agents: keys.map((k) => ({
      name: k.user.name ?? k.user.email,
      email: k.user.email,
      keyHint: k.keyHint,
      label: k.label,
      active: !k.revokedAt,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    })),
  });
});

// Mint a key for a (new or existing) agent. Returns the raw key ONCE.
router.post('/agents', async (req, res) => {
  const { name, label } = (req.body ?? {}) as { name?: string; label?: string };
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
    res.status(400).json({ error: 'Name must be lowercase letters, digits, and dashes (2–31 chars).' });
    return;
  }
  try {
    const { rawKey, user } = await authService.createAgentKey(
      name,
      typeof label === 'string' && label.trim() ? label.trim() : undefined
    );
    res.status(201).json({ rawKey, agent: { name: user.name, email: user.email } });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Revoke all live keys for an agent.
router.post('/agents/:name/revoke', async (req, res) => {
  const revoked = await authService.revokeAgentKeys(req.params.name);
  res.json({ revoked });
});

export { router as adminRoutes };
