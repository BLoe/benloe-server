// Yahoo OAuth 2.0 Service for Fantasy Sports API
// (Adapted from Fantasy Hawk)
import { config } from '../config.js';

const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

export interface YahooTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

export class YahooOAuthService {
  private clientId: string;
  private clientSecret: string;
  private callbackUrl: string;

  constructor() {
    this.clientId = config.yahooClientId;
    this.clientSecret = config.yahooClientSecret;
    this.callbackUrl = config.mcpYahooCallbackUrl;

    if (!this.clientId || !this.clientSecret || !this.callbackUrl) {
      throw new Error('Missing Yahoo OAuth configuration');
    }
  }

  /**
   * Generate authorization URL for user to visit
   * The state parameter is used to carry the MCP OAuth state through the Yahoo flow
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      state: state,
    });

    return `${YAHOO_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async getAccessToken(code: string): Promise<YahooTokens> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.callbackUrl,
      code: code,
      grant_type: 'authorization_code',
    });

    console.log('Exchanging Yahoo code for access token...');

    const response = await fetch(YAHOO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Yahoo token exchange error:', errorText);
      throw new Error('Failed to exchange code for access token');
    }

    const data = (await response.json()) as any;
    const expiresAt = Date.now() + data.expires_in * 1000;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in, // Usually 3600 (1 hour)
      expiresAt,
    };
  }

  /**
   * Refresh expired access token
   */
  async refreshAccessToken(refreshToken: string): Promise<YahooTokens> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(YAHOO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Yahoo token refresh error:', errorText);
      throw new Error('Failed to refresh access token');
    }

    const data = (await response.json()) as any;
    const expiresAt = Date.now() + data.expires_in * 1000;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt,
    };
  }
}

// Singleton instance
export const yahooOAuthService = new YahooOAuthService();
