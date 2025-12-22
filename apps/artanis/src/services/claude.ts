/**
 * Claude API Service
 *
 * Handles proxying requests to the Anthropic Claude API using the user's
 * encrypted API key.
 */

import { PrismaClient } from '@prisma/client';
import { getEncryptionService } from './encryption';

const prisma = new PrismaClient();

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model: string;
  messages: ClaudeMessage[];
  max_tokens: number;
  system?: string | undefined;
  temperature?: number | undefined;
  top_p?: number | undefined;
  stop_sequences?: string[] | undefined;
}

export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClaudeError {
  type: string;
  error: {
    type: string;
    message: string;
  };
}

export class ClaudeService {
  /**
   * Get the decrypted API key for a user
   */
  private async getApiKey(userId: string): Promise<string | null> {
    const apiKey = await prisma.apiKey.findUnique({
      where: {
        userId_provider: { userId, provider: 'anthropic' },
      },
    });

    if (!apiKey) {
      return null;
    }

    const encryptionService = getEncryptionService();
    return encryptionService.decrypt(apiKey.encryptedKey);
  }

  /**
   * Update lastUsedAt for the API key
   */
  private async updateLastUsed(userId: string): Promise<void> {
    await prisma.apiKey.update({
      where: {
        userId_provider: { userId, provider: 'anthropic' },
      },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Make a non-streaming request to the Claude API
   */
  async sendMessage(
    userId: string,
    request: ClaudeRequest
  ): Promise<ClaudeResponse | ClaudeError> {
    const apiKey = await this.getApiKey(userId);

    if (!apiKey) {
      return {
        type: 'error',
        error: {
          type: 'no_api_key',
          message:
            'No Anthropic API key configured. Please add your API key in the dashboard.',
        },
      };
    }

    try {
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (response.ok) {
        // Update last used timestamp
        await this.updateLastUsed(userId);
        return data as ClaudeResponse;
      }

      return data as ClaudeError;
    } catch (error) {
      return {
        type: 'error',
        error: {
          type: 'network_error',
          message: `Failed to connect to Claude API: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      };
    }
  }

  /**
   * Make a streaming request to the Claude API
   * Returns a readable stream that can be piped to the client
   */
  async streamMessage(
    userId: string,
    request: ClaudeRequest
  ): Promise<{ stream: ReadableStream; error?: never } | { error: ClaudeError; stream?: never }> {
    const apiKey = await this.getApiKey(userId);

    if (!apiKey) {
      return {
        error: {
          type: 'error',
          error: {
            type: 'no_api_key',
            message:
              'No Anthropic API key configured. Please add your API key in the dashboard.',
          },
        },
      };
    }

    try {
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          ...request,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return { error: errorData as ClaudeError };
      }

      if (!response.body) {
        return {
          error: {
            type: 'error',
            error: {
              type: 'stream_error',
              message: 'No response body received from Claude API',
            },
          },
        };
      }

      // Update last used timestamp
      await this.updateLastUsed(userId);

      return { stream: response.body };
    } catch (error) {
      return {
        error: {
          type: 'error',
          error: {
            type: 'network_error',
            message: `Failed to connect to Claude API: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        },
      };
    }
  }

  /**
   * Check if user has a valid API key configured
   */
  async hasApiKey(userId: string): Promise<boolean> {
    const apiKey = await prisma.apiKey.findUnique({
      where: {
        userId_provider: { userId, provider: 'anthropic' },
      },
    });
    return !!apiKey;
  }
}

export const claudeService = new ClaudeService();
