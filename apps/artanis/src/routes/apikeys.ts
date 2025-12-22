import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getEncryptionService, EncryptionService } from '../services/encryption';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const addKeySchema = z.object({
  key: z.string().min(1, 'API key is required'),
  provider: z.string().default('anthropic'),
  label: z.string().nullable().optional(),
});

/**
 * GET /api/keys
 * List user's API keys (hints only, not full keys)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const keys = await prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        keyHint: true,
        label: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ keys });
  } catch (error) {
    console.error('Error listing API keys:', error);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * POST /api/keys
 * Add a new API key (encrypts and stores)
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const parsed = addKeySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.errors,
      });
      return;
    }

    const { key, provider, label } = parsed.data;

    // Encrypt the API key
    const encryptionService = getEncryptionService();
    const encryptedKey = encryptionService.encrypt(key);
    const keyHint = EncryptionService.generateKeyHint(key);

    // Upsert (create or update if exists for this provider)
    const result = await prisma.apiKey.upsert({
      where: {
        userId_provider: { userId, provider },
      },
      update: {
        encryptedKey,
        keyHint,
        label: label ?? null,
      },
      create: {
        userId,
        provider,
        encryptedKey,
        keyHint,
        label: label ?? null,
      },
      select: {
        id: true,
        provider: true,
        keyHint: true,
        label: true,
        createdAt: true,
      },
    });

    res.json({
      message: 'API key saved successfully',
      key: result,
    });
  } catch (error) {
    console.error('Error saving API key:', error);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

/**
 * DELETE /api/keys/:provider
 * Remove an API key
 */
router.delete('/:provider', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const provider = req.params.provider as string;

    const deleted = await prisma.apiKey.deleteMany({
      where: { userId, provider },
    });

    if (deleted.count === 0) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    res.json({ message: 'API key deleted successfully' });
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

/**
 * POST /api/keys/:provider/test
 * Test if an API key is valid
 */
router.post('/:provider/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const provider = req.params.provider as string;

    // Get the encrypted key
    const apiKey = await prisma.apiKey.findUnique({
      where: {
        userId_provider: { userId, provider },
      },
    });

    if (!apiKey) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    // Decrypt the key
    const encryptionService = getEncryptionService();
    const decryptedKey = encryptionService.decrypt(apiKey.encryptedKey);

    // Test the key based on provider
    let isValid = false;
    let errorMessage = '';

    if (provider === 'anthropic') {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': decryptedKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });

        if (response.ok) {
          isValid = true;
        } else {
          const errorData = (await response.json()) as { error?: { message?: string } };
          errorMessage = errorData.error?.message || 'Unknown error';
        }
      } catch (e) {
        errorMessage = 'Failed to connect to Anthropic API';
      }
    } else {
      res.status(400).json({ error: `Unknown provider: ${provider}` });
      return;
    }

    // Update lastUsedAt if valid
    if (isValid) {
      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });
    }

    res.json({
      valid: isValid,
      provider,
      hint: apiKey.keyHint,
      ...(errorMessage && { error: errorMessage }),
    });
  } catch (error) {
    console.error('Error testing API key:', error);
    res.status(500).json({ error: 'Failed to test API key' });
  }
});

/**
 * GET /api/keys/:provider/status
 * Check if user has a key configured for a provider
 */
router.get('/:provider/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const provider = req.params.provider as string;

    const apiKey = await prisma.apiKey.findUnique({
      where: {
        userId_provider: { userId, provider },
      },
      select: {
        id: true,
        keyHint: true,
        label: true,
        lastUsedAt: true,
      },
    });

    res.json({
      hasKey: !!apiKey,
      ...(apiKey && {
        hint: apiKey.keyHint,
        label: apiKey.label,
        lastUsedAt: apiKey.lastUsedAt,
      }),
    });
  } catch (error) {
    console.error('Error checking API key status:', error);
    res.status(500).json({ error: 'Failed to check API key status' });
  }
});

export { router as apiKeysRouter };
