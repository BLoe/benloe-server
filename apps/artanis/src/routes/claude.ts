import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { claudeService, ClaudeError } from '../services/claude';

const router = Router();

// Request validation schema
const messageSchema = z.object({
  model: z.string().default('claude-sonnet-4-20250514'),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ),
  max_tokens: z.number().min(1).max(4096).default(1024),
  system: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
});

/**
 * Helper to check if response is an error
 */
function isError(response: unknown): response is ClaudeError {
  return (
    typeof response === 'object' &&
    response !== null &&
    'type' in response &&
    (response as ClaudeError).type === 'error'
  );
}

/**
 * POST /api/claude/messages
 * Proxy to Claude Messages API (non-streaming)
 */
router.post('/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const parsed = messageSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.errors,
      });
      return;
    }

    const response = await claudeService.sendMessage(userId, parsed.data);

    if (isError(response)) {
      const statusCode = response.error.type === 'no_api_key' ? 400 : 500;
      res.status(statusCode).json(response);
      return;
    }

    res.json(response);
  } catch (error) {
    console.error('Error proxying Claude request:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

/**
 * POST /api/claude/messages/stream
 * Streaming proxy to Claude Messages API (SSE)
 */
router.post(
  '/messages/stream',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const parsed = messageSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid request',
          details: parsed.error.errors,
        });
        return;
      }

      const result = await claudeService.streamMessage(userId, parsed.data);

      if (result.error) {
        const statusCode = result.error.error.type === 'no_api_key' ? 400 : 500;
        res.status(statusCode).json(result.error);
        return;
      }

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // Pipe the stream to the response
      const reader = result.stream.getReader();
      const decoder = new TextDecoder();

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              res.end();
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
          }
        } catch (error) {
          console.error('Stream error:', error);
          res.end();
        }
      };

      // Handle client disconnect
      req.on('close', () => {
        reader.cancel();
      });

      processStream();
    } catch (error) {
      console.error('Error setting up Claude stream:', error);
      res.status(500).json({ error: 'Failed to set up stream' });
    }
  }
);

/**
 * GET /api/claude/status
 * Check if user has Claude API key configured
 */
router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const hasKey = await claudeService.hasApiKey(userId);

    res.json({ hasKey, provider: 'anthropic' });
  } catch (error) {
    console.error('Error checking Claude status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

export { router as claudeRouter };
