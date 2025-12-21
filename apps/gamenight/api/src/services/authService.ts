import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  timezone: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export class AuthService {
  /**
   * Verify a JWT token and return user data
   */
  verifyToken(token: string): AuthUser | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & {
        userId: string;
        email: string;
        name?: string;
        avatar?: string;
        timezone?: string;
        createdAt?: string;
        lastLoginAt?: string;
      };

      // Validate required fields
      if (!payload.userId || !payload.email) {
        return null;
      }

      return {
        id: payload.userId,
        email: payload.email,
        name: payload.name || null,
        avatar: payload.avatar || null,
        timezone: payload.timezone || 'UTC',
        createdAt: payload.createdAt || new Date().toISOString(),
        lastLoginAt: payload.lastLoginAt || null,
      };
    } catch (error) {
      console.error('Token verification failed:', error);
      return null;
    }
  }

  /**
   * Get user by ID from auth service
   */
  async getUserById(userId: string): Promise<AuthUser | null> {
    try {
      const authServiceUrl = process.env['AUTH_SERVICE_URL'] || 'http://localhost:3002';

      const response = await fetch(`${authServiceUrl}/api/auth/user/${userId}`, {
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
      console.error('Failed to get user:', error);
      return null;
    }
  }
}

export const authService = new AuthService();
