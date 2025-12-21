// Shared authentication types for all benloe.com applications

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  timezone: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface AuthToken {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

export interface AuthResponse {
  user: User;
  message: string;
}

export interface AuthError {
  error: string;
  details?: unknown;
}
