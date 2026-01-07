import { Router, Request, Response } from 'express';
import { validateAccessToken, isTokenError } from '../oauth/tokens.js';
import { executeTool, getToolDefinitions, ToolResult } from './tools.js';
import { McpSession } from '../services/database.js';

const router = Router();

// MCP JSON-RPC types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Standard JSON-RPC error codes
const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
};

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * MCP endpoint - Streamable HTTP transport
 */
router.post('/mcp', async (req: Request, res: Response) => {
  // Authenticate
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing or invalid Authorization header',
      },
    });
  }

  const sessionResult = validateAccessToken(token);
  if (isTokenError(sessionResult)) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: sessionResult.error_description,
      },
    });
  }

  const session = sessionResult as McpSession;

  // Parse JSON-RPC request
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: ERROR_CODES.PARSE_ERROR,
        message: 'Invalid JSON',
      },
    });
  }

  const request = body as JsonRpcRequest;

  // Validate JSON-RPC request
  if (request.jsonrpc !== '2.0' || !request.method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: request.id || null,
      error: {
        code: ERROR_CODES.INVALID_REQUEST,
        message: 'Invalid JSON-RPC request',
      },
    });
  }

  console.log('MCP request:', request.method, request.params ? JSON.stringify(request.params) : '');

  // Handle MCP methods
  try {
    const response = await handleMcpMethod(request, session);
    res.json(response);
  } catch (error: any) {
    console.error('MCP error:', error);
    res.json({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: error.message || 'Internal error',
      },
    });
  }
});

/**
 * Handle MCP methods
 */
async function handleMcpMethod(
  request: JsonRpcRequest,
  session: McpSession
): Promise<JsonRpcResponse> {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'yahoo-fantasy-mcp',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: getToolDefinitions(),
        },
      };

    case 'tools/call': {
      const toolParams = params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!toolParams?.name) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: ERROR_CODES.INVALID_PARAMS,
            message: 'Missing tool name',
          },
        };
      }

      const result = await executeTool(
        toolParams.name,
        toolParams.arguments || {},
        session
      );

      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    }

    case 'ping':
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: ERROR_CODES.METHOD_NOT_FOUND,
          message: `Unknown method: ${method}`,
        },
      };
  }
}

export const mcpRouter = router;
