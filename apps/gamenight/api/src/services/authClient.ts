import jwt from 'jsonwebtoken';
import { JWTPayload, AuthUser } from '../types';

export class AuthClient {
  private jwtSecret: string;
  private authServiceUrl: string;

  constructor() {
    this.jwtSecret = process.env['JWT_SECRET']!;
    this.authServiceUrl = process.env['AUTH_SERVICE_URL'] || 'http://localhost:3002';

    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  async verifyJWT(token: string): Promise<JWTPayload> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;
      return decoded;
    } catch {
      throw new Error('Invalid token');
    }
  }

  async getUserFromAuth(): Promise<AuthUser | null> {
    try {
      // In production, this would make an HTTP request to the auth service
      // For now, we'll make a direct call to the auth service API
      const response = await fetch(`${this.authServiceUrl}/api/auth/me`, {
        method: 'GET',
        headers: {
          Cookie: `token=${process.env['INTERNAL_AUTH_TOKEN'] || ''}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { user: AuthUser };
      return data.user;
    } catch {
      return null;
    }
  }

  async validateUserById(userId: string): Promise<AuthUser | null> {
    try {
      // Make direct call to auth service to validate user
      const response = await fetch(`${this.authServiceUrl}/api/auth/user/${userId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env['INTERNAL_AUTH_TOKEN'] || ''}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { user: AuthUser };
      return data.user;
    } catch (error) {
      console.error('Failed to validate user:', error);
      return null;
    }
  }
}

let _authClient: AuthClient | null = null;

export const authClient = (): AuthClient => {
  if (!_authClient) {
    _authClient = new AuthClient();
  }
  return _authClient;
};
