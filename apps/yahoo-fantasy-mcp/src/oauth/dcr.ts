import { v4 as uuidv4 } from 'uuid';
import { createClient, getClient, McpClient } from '../services/database.js';
import { generateClientSecret, hashClientSecret, verifyClientSecret } from '../services/crypto.js';
import { config } from '../config.js';

export interface DcrRequest {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

export interface DcrResponse {
  client_id: string;
  client_secret?: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  client_id_issued_at: number;
}

export interface DcrError {
  error: string;
  error_description: string;
}

/**
 * Register a new OAuth client (Dynamic Client Registration)
 */
export function registerClient(request: DcrRequest): DcrResponse | DcrError {
  // Validate request
  if (!request.client_name) {
    return {
      error: 'invalid_client_metadata',
      error_description: 'client_name is required',
    };
  }

  if (!request.redirect_uris || request.redirect_uris.length === 0) {
    return {
      error: 'invalid_redirect_uri',
      error_description: 'At least one redirect_uri is required',
    };
  }

  // Validate redirect URIs (must be localhost or HTTPS)
  for (const uri of request.redirect_uris) {
    try {
      const url = new URL(uri);
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      const isHttps = url.protocol === 'https:';
      const isHttp = url.protocol === 'http:';

      if (!isHttps && !(isHttp && isLocalhost)) {
        return {
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri must be HTTPS or localhost: ${uri}`,
        };
      }
    } catch {
      return {
        error: 'invalid_redirect_uri',
        error_description: `Invalid redirect_uri: ${uri}`,
      };
    }
  }

  // Generate client credentials
  const clientId = uuidv4();
  const clientSecret = generateClientSecret();
  const clientSecretHash = hashClientSecret(clientSecret);

  // Default grant types and response types
  const grantTypes = request.grant_types || ['authorization_code', 'refresh_token'];
  const responseTypes = request.response_types || ['code'];

  // Validate grant types
  const allowedGrantTypes = ['authorization_code', 'refresh_token'];
  for (const grantType of grantTypes) {
    if (!allowedGrantTypes.includes(grantType)) {
      return {
        error: 'invalid_client_metadata',
        error_description: `Unsupported grant_type: ${grantType}`,
      };
    }
  }

  // Validate response types
  const allowedResponseTypes = ['code'];
  for (const responseType of responseTypes) {
    if (!allowedResponseTypes.includes(responseType)) {
      return {
        error: 'invalid_client_metadata',
        error_description: `Unsupported response_type: ${responseType}`,
      };
    }
  }

  // Store client
  try {
    createClient(
      clientId,
      clientSecretHash,
      request.client_name,
      request.redirect_uris,
      grantTypes,
      responseTypes
    );
  } catch (error: any) {
    console.error('Failed to create client:', error);
    return {
      error: 'server_error',
      error_description: 'Failed to register client',
    };
  }

  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: request.client_name,
    redirect_uris: request.redirect_uris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: request.token_endpoint_auth_method || 'client_secret_post',
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Validate a client and optionally its secret
 */
export function validateClient(
  clientId: string,
  clientSecret?: string,
  redirectUri?: string
): McpClient | DcrError {
  const client = getClient(clientId);

  if (!client) {
    return {
      error: 'invalid_client',
      error_description: 'Client not found',
    };
  }

  // Validate secret if provided
  if (clientSecret !== undefined) {
    if (!verifyClientSecret(clientSecret, client.clientSecretHash)) {
      return {
        error: 'invalid_client',
        error_description: 'Invalid client secret',
      };
    }
  }

  // Validate redirect URI if provided
  if (redirectUri !== undefined) {
    if (!client.redirectUris.includes(redirectUri)) {
      return {
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uri not registered for this client',
      };
    }
  }

  return client;
}

/**
 * Check if a response is an error
 */
export function isDcrError(response: any): response is DcrError {
  return response && typeof response.error === 'string';
}
