export type UserRole = 'user' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
}

export interface YahooTokens {
  userId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpires: number;
  createdAt: number;
  updatedAt: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
