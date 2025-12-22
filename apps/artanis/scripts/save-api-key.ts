/**
 * One-time script to save an API key for a user
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/srv/benloe/.env' });

import { PrismaClient } from '@prisma/client';
import { getEncryptionService, EncryptionService } from '../src/services/encryption';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:/srv/benloe/data/artanis.db'
    }
  }
});

async function main() {
  const userEmail = 'below413@gmail.com';
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not found in environment');
    process.exit(1);
  }

  console.log('Looking up user:', userEmail);

  // Find the user
  const user = await prisma.user.findUnique({
    where: { email: userEmail }
  });

  if (!user) {
    console.error('User not found:', userEmail);
    process.exit(1);
  }

  console.log('Found user:', user.id);

  // Encrypt the API key
  const encryptionService = getEncryptionService();
  const encryptedKey = encryptionService.encrypt(apiKey);
  const keyHint = EncryptionService.generateKeyHint(apiKey);

  console.log('Encrypted key, hint:', keyHint);

  // Upsert the API key (create or update if exists)
  const result = await prisma.apiKey.upsert({
    where: {
      userId_provider: {
        userId: user.id,
        provider: 'anthropic'
      }
    },
    update: {
      encryptedKey,
      keyHint,
      label: 'Claude API Key'
    },
    create: {
      userId: user.id,
      provider: 'anthropic',
      encryptedKey,
      keyHint,
      label: 'Claude API Key'
    }
  });

  console.log('API key saved successfully!');
  console.log('Record ID:', result.id);
  console.log('Provider:', result.provider);
  console.log('Hint:', result.keyHint);

  // Verify we can decrypt it
  const decrypted = encryptionService.decrypt(result.encryptedKey);
  console.log('Decryption verified:', decrypted === apiKey ? 'YES' : 'NO');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
