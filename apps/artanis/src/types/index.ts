export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  role: UserRole;
  timezone: string;
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface MagicLinkToken {
  id: string;
  email: string;
  token: string;
  expiresAt: Date;
  used: boolean;
}

export interface LoginRequest {
  email: string;
  redirectUrl?: string;
}

export interface VerifyTokenRequest {
  token: string;
}
