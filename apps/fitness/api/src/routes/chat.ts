import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { FITNESS_TOOLS } from '../tools/definitions';
import { executeToolCall } from '../services/toolExecutor';
import { buildSystemPrompt } from '../services/systemPrompt';

const router = Router();
const prisma = new PrismaClient();

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3002';

// Send message to AI and get response
router.post('/message', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const token = req.cookies.token;
    const { message, includeHistory = true } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // Get user profile for context
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
    });

    // Get recent chat history if requested
    let chatHistory: { role: string; content: string }[] = [];
    if (includeHistory) {
      const recentMessages = await prisma.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      chatHistory = recentMessages.reverse().map((m) => ({
        role: m.role,
        content: m.content,
      }));
    }

    // Save user message
    await prisma.chatMessage.create({
      data: {
        userId,
        role: 'user',
        content: message,
      },
    });

    // Build messages array
    const messages = [
      ...chatHistory,
      { role: 'user', content: message },
    ];

    // Build system prompt with context
    const systemPrompt = buildSystemPrompt(profile, new Date());

    // Call Claude API via Artanis proxy
    let assistantMessage = '';
    let toolCallsExecuted: any[] = [];
    let iterations = 0;
    const maxIterations = 10;

    // Tool use loop
    while (iterations < maxIterations) {
      iterations++;

      const claudeResponse = await fetch(`${AUTH_SERVICE_URL}/api/claude/messages`, {
        method: 'POST',
        headers: {
          Cookie: `token=${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          system: systemPrompt,
          messages,
          max_tokens: 4096,
          tools: FITNESS_TOOLS,
        }),
      });

      if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text();
        console.error('Claude API error:', errorText);
        res.status(500).json({ error: 'Failed to get AI response' });
        return;
      }

      const claudeData = await claudeResponse.json() as {
        stop_reason?: string;
        content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: any }>;
      };

      // Check stop reason
      if (claudeData.stop_reason === 'end_turn') {
        // Extract text content
        const textContent = claudeData.content?.find((c: any) => c.type === 'text');
        assistantMessage = textContent?.text || '';
        break;
      }

      if (claudeData.stop_reason === 'tool_use') {
        // Extract tool uses
        const toolUses = claudeData.content?.filter((c: any) => c.type === 'tool_use') || [];

        if (toolUses.length === 0) {
          // No tool calls, get text response
          const textContent = claudeData.content?.find((c: any) => c.type === 'text');
          assistantMessage = textContent?.text || '';
          break;
        }

        // Add assistant message with tool use to history
        messages.push({
          role: 'assistant',
          content: claudeData.content,
        });

        // Execute each tool call
        const toolResults: any[] = [];
        for (const toolUse of toolUses) {
          if (!toolUse.name) continue;
          const result = await executeToolCall(
            toolUse.name,
            toolUse.input || {},
            userId,
            token
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id || '',
            content: JSON.stringify(result),
          });
          toolCallsExecuted.push({
            tool: toolUse.name,
            input: toolUse.input || {},
            result,
          });
        }

        // Add tool results to messages
        messages.push({
          role: 'user',
          content: toolResults,
        });
      } else {
        // Unknown stop reason, get whatever text we have
        const textContent = claudeData.content?.find((c: any) => c.type === 'text');
        assistantMessage = textContent?.text || '';
        break;
      }
    }

    // Save assistant message
    await prisma.chatMessage.create({
      data: {
        userId,
        role: 'assistant',
        content: assistantMessage,
      },
    });

    res.json({
      message: assistantMessage,
      toolCalls: toolCallsExecuted,
    });
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// Get chat history
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { limit } = req.query;

    const messages = await prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit as string) : 50,
    });

    res.json({ messages: messages.reverse() });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Clear chat history
router.delete('/history', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    await prisma.chatMessage.deleteMany({
      where: { userId },
    });

    res.json({ message: 'Chat history cleared' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

export { router as chatRoutes };
