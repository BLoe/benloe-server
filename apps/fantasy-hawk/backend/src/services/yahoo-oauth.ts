// Yahoo OAuth 2.0 Service for Fantasy Sports API
const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

export class YahooOAuthService {
  private clientId: string;
  private clientSecret: string;
  private callbackUrl: string;

  constructor() {
    this.clientId = process.env.YAHOO_CLIENT_ID!;
    this.clientSecret = process.env.YAHOO_CLIENT_SECRET!;
    this.callbackUrl = process.env.YAHOO_CALLBACK_URL!;

    if (!this.clientId || !this.clientSecret || !this.callbackUrl) {
      throw new Error('Missing Yahoo OAuth configuration');
    }
  }

  /**
   * Step 1: Generate authorization URL for user to visit
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
   * Step 2: Exchange authorization code for access token
   */
  async getAccessToken(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.callbackUrl,
      code: code,
      grant_type: 'authorization_code',
    });

    console.log('Exchanging code for access token...');

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

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in, // Usually 3600 (1 hour)
    };
  }

  /**
   * Step 3: Refresh expired access token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
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

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Make authenticated request to Yahoo Fantasy API
   */
  async makeAuthenticatedRequest(url: string, accessToken: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'): Promise<any> {
    // Add format=json to get JSON response instead of XML
    const separator = url.includes('?') ? '&' : '?';
    const urlWithFormat = `${url}${separator}format=json`;

    console.log('Making Yahoo API request:', urlWithFormat);

    const response = await fetch(urlWithFormat, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Yahoo API error (${urlWithFormat}):`, errorText);
      throw new Error(`Yahoo API request failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('Yahoo API response received successfully');
    return data;
  }
}

export const yahooOAuthService = new YahooOAuthService();
