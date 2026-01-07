import crypto from 'crypto';

/**
 * Verify a PKCE code_verifier against the stored code_challenge
 *
 * S256: The code_challenge is the base64url-encoded SHA256 hash of the verifier
 * plain: The code_challenge is the verifier itself (not secure, we don't support)
 */
export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  method: string
): boolean {
  if (method !== 'S256') {
    // Only support S256 for security
    return false;
  }

  // Compute SHA256 hash of the verifier and base64url encode it
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const computed = hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return computed === codeChallenge;
}

/**
 * Validate that a code_challenge is properly formatted
 */
export function isValidCodeChallenge(challenge: string): boolean {
  // Must be 43-128 characters (base64url encoded 32-96 bytes)
  if (challenge.length < 43 || challenge.length > 128) {
    return false;
  }

  // Must be valid base64url characters
  return /^[A-Za-z0-9_-]+$/.test(challenge);
}

/**
 * Validate that a code_verifier is properly formatted
 */
export function isValidCodeVerifier(verifier: string): boolean {
  // Must be 43-128 characters
  if (verifier.length < 43 || verifier.length > 128) {
    return false;
  }

  // Must be valid characters (unreserved URI characters)
  return /^[A-Za-z0-9._~-]+$/.test(verifier);
}
