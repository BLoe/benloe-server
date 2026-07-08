/**
 * Manage agent access keys (inbound auth for non-human principals).
 *
 *   tsx scripts/agent-key.ts create <name> [label]   # mint a key (shown once)
 *   tsx scripts/agent-key.ts revoke <name>           # revoke all of an agent's keys
 *   tsx scripts/agent-key.ts list                    # list keys (hints only)
 *
 * An agent is a User with role "agent" (email <name>@agents.benloe.com). It
 * presents the raw key as `Authorization: Bearer <key>`; Artanis stores only
 * the SHA-256 hash.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '/srv/benloe/.env' });

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:/srv/benloe/data/artanis.db' } },
});

const hash = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
const emailFor = (name: string) => `${name}@agents.benloe.com`;

async function create(name: string, label?: string) {
  const email = emailFor(name);
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email, name, role: 'agent' } });
  } else if (user.role !== 'agent') {
    throw new Error(`${email} exists but is not an agent principal`);
  }
  const rawKey = `agk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.agentKey.create({
    data: { userId: user.id, tokenHash: hash(rawKey), keyHint: rawKey.slice(-6), label: label ?? null },
  });
  console.log(`\n  agent:  ${name}  (${email}, role=agent)`);
  if (label) console.log(`  label:  ${label}`);
  console.log(`\n  KEY (shown once — store it now):\n\n    ${rawKey}\n`);
  console.log(`  Use as:  Authorization: Bearer ${rawKey}\n`);
}

async function revoke(name: string) {
  const user = await prisma.user.findUnique({ where: { email: emailFor(name) } });
  if (!user) return console.log(`no such agent: ${name}`);
  const r = await prisma.agentKey.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(`revoked ${r.count} key(s) for ${name}`);
}

async function list() {
  const keys = await prisma.agentKey.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' } });
  if (!keys.length) return console.log('no agent keys');
  for (const k of keys) {
    console.log(
      `${(k.user.name ?? k.user.email).padEnd(12)}  …${k.keyHint}  ${k.revokedAt ? 'REVOKED' : 'active '}  ` +
        `used:${k.lastUsedAt ? k.lastUsedAt.toISOString() : 'never'}  ${k.label ?? ''}`
    );
  }
}

const [cmd, name, ...rest] = process.argv.slice(2);
(async () => {
  try {
    if (cmd === 'create' && name) await create(name, rest.join(' ') || undefined);
    else if (cmd === 'revoke' && name) await revoke(name);
    else if (cmd === 'list') await list();
    else console.log('usage: agent-key.ts <create <name> [label] | revoke <name> | list>');
  } finally {
    await prisma.$disconnect();
  }
})();
