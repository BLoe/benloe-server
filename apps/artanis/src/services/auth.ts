import crypto from 'crypto';

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

import { JWTPayload, UserRole } from '../types';

import { sendMagicLink } from './email';

const prisma = new PrismaClient();

export class AuthService {
  private jwtSecret: string;
  private jwtExpiresIn: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET!;
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '30d';

    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  async sendMagicLink(email: string, redirectUrl?: string): Promise<void> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Clean up any existing tokens for this email
    await prisma.magicLinkToken.deleteMany({
      where: { email },
    });

    // Create new magic link token
    await prisma.magicLinkToken.create({
      data: {
        email,
        token,
        expiresAt,
      },
    });

    // Send the magic link email
    await sendMagicLink(email, token, redirectUrl);
  }

  async verifyMagicLink(token: string): Promise<{
    user: {
      id: string;
      email: string;
      name: string | null;
      avatar: string | null;
      role: string;
      timezone: string;
      createdAt: Date;
      lastLoginAt: Date | null;
    };
    jwtToken: string;
  }> {
    const magicToken = await prisma.magicLinkToken.findUnique({
      where: { token },
    });

    if (!magicToken || magicToken.used || magicToken.expiresAt < new Date()) {
      throw new Error('Invalid or expired token');
    }

    // Mark token as used
    await prisma.magicLinkToken.update({
      where: { token },
      data: { used: true },
    });

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: magicToken.email },
    });

    if (!user) {
      const defaultName = magicToken.email.split('@')[0];
      user = await prisma.user.create({
        data: {
          email: magicToken.email,
          name: defaultName || null, // Default name from email
        },
      });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const jwtToken = await this.issueSession(user);
    return { user, jwtToken };
  }

  /** Sign a JWT for a user and persist a session. Used by magic-link + agent login. */
  private async issueSession(user: { id: string; email: string; role: string }): Promise<string> {
    const jwtPayload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
    };
    const jwtToken = jwt.sign(jwtPayload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
    } as jwt.SignOptions);
    await prisma.session.create({
      data: {
        userId: user.id,
        token: jwtToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });
    return jwtToken;
  }

  /** Exchange an agent access key for a browser session (so agents can use the UI). */
  async agentLogin(rawKey: string): Promise<{ user: { id: string; email: string; name: string | null; role: string }; jwtToken: string }> {
    const user = await this.verifyAgentKey(rawKey);
    const jwtToken = await this.issueSession(user);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, jwtToken };
  }

  async verifyJWT(token: string): Promise<JWTPayload> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;

      // Check if session exists and is valid
      const session = await prisma.session.findUnique({
        where: { token },
      });

      if (!session || session.expiresAt < new Date()) {
        throw new Error('Session expired');
      }

      // Update session last used
      await prisma.session.update({
        where: { token },
        data: { lastUsed: new Date() },
      });

      return decoded;
    } catch {
      throw new Error('Invalid token');
    }
  }

  async getUserById(userId: string) {
    return await prisma.user.findUnique({
      where: { id: userId },
    });
  }

  // ---- Agent access keys (non-human principals) ----

  private hashAgentKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  /** Resolve a raw agent key to its User, or throw. Updates last-used stamps. */
  async verifyAgentKey(rawKey: string) {
    const tokenHash = this.hashAgentKey(rawKey);
    const key = await prisma.agentKey.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!key || key.revokedAt) {
      throw new Error('Invalid or revoked agent key');
    }
    const now = new Date();
    await prisma.agentKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
    await prisma.user.update({ where: { id: key.userId }, data: { lastLoginAt: now } });
    return key.user;
  }

  /** Mint a new key for a named agent, creating the agent User if needed.
      Returns the raw key ONCE — only its hash is stored. */
  async createAgentKey(
    name: string,
    label?: string
  ): Promise<{ rawKey: string; user: { id: string; email: string; name: string | null; role: string } }> {
    const email = `${name}@agents.benloe.com`;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { email, name, role: 'agent' } });
    } else if (user.role !== 'agent') {
      throw new Error(`${email} exists but is not an agent principal`);
    }
    const rawKey = `agk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.agentKey.create({
      data: {
        userId: user.id,
        tokenHash: this.hashAgentKey(rawKey),
        keyHint: rawKey.slice(-6),
        label: label ?? null,
      },
    });
    return { rawKey, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  /** Revoke all live keys for a named agent. Returns the count revoked. */
  async revokeAgentKeys(name: string): Promise<number> {
    const email = `${name}@agents.benloe.com`;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return 0;
    const r = await prisma.agentKey.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return r.count;
  }

  async listAgentKeys() {
    return prisma.agentKey.findMany({
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async logoutAllSessions(userId: string): Promise<void> {
    await prisma.session.deleteMany({
      where: { userId },
    });
  }

  async cleanupExpiredTokens(): Promise<void> {
    const now = new Date();

    // Clean up expired magic link tokens
    await prisma.magicLinkToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Clean up expired sessions
    await prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });
  }
}

export const authService = new AuthService();
