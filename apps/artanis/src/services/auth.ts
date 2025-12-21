import crypto from 'crypto';

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

import { JWTPayload } from '../types';

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

    // Generate JWT token
    const jwtPayload: JWTPayload = {
      userId: user.id,
      email: user.email,
    };

    const jwtToken = jwt.sign(jwtPayload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
    } as jwt.SignOptions);

    // Create session record
    await prisma.session.create({
      data: {
        userId: user.id,
        token: jwtToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    return { user, jwtToken };
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
