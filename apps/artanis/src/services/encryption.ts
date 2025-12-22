import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Encryption service for securely storing sensitive data like API keys.
 * Uses AES-256-GCM for authenticated encryption.
 */
class EncryptionService {
  private secretKey: Buffer;

  constructor() {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
      throw new Error('ENCRYPTION_SECRET environment variable is required');
    }

    // Derive a 256-bit key from the secret using SHA-256
    this.secretKey = crypto.createHash('sha256').update(secret).digest();
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Returns a base64-encoded string containing: iv + authTag + ciphertext
   */
  encrypt(plaintext: string): string {
    // Generate random IV for each encryption
    const iv = crypto.randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, this.secretKey, iv);

    // Encrypt the plaintext
    let ciphertext = cipher.update(plaintext, 'utf8');
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);

    // Get the authentication tag
    const authTag = cipher.getAuthTag();

    // Combine iv + authTag + ciphertext and encode as base64
    const combined = Buffer.concat([iv, authTag, ciphertext]);
    return combined.toString('base64');
  }

  /**
   * Decrypts a base64-encoded encrypted string.
   * Expects format: iv + authTag + ciphertext
   */
  decrypt(encryptedBase64: string): string {
    // Decode from base64
    const combined = Buffer.from(encryptedBase64, 'base64');

    // Extract components
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, this.secretKey, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let plaintext = decipher.update(ciphertext);
    plaintext = Buffer.concat([plaintext, decipher.final()]);

    return plaintext.toString('utf8');
  }

  /**
   * Generates a hint for displaying the API key (last 4 characters).
   */
  static generateKeyHint(apiKey: string): string {
    if (apiKey.length <= 4) {
      return '****';
    }
    return `...${apiKey.slice(-4)}`;
  }

  /**
   * Validates that the encryption service is properly configured.
   */
  validate(): boolean {
    try {
      const testString = 'test-encryption-validation';
      const encrypted = this.encrypt(testString);
      const decrypted = this.decrypt(encrypted);
      return decrypted === testString;
    } catch {
      return false;
    }
  }
}

// Singleton instance - lazy initialization to allow env to be loaded first
let encryptionServiceInstance: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionServiceInstance) {
    encryptionServiceInstance = new EncryptionService();
  }
  return encryptionServiceInstance;
}

export { EncryptionService };
