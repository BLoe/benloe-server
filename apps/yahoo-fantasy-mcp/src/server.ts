import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { getDatabase, cleanupExpiredRecords } from './services/database.js';
import { oauthRouter } from './oauth/endpoints.js';
import { mcpRouter } from './mcp/index.js';

// Initialize database
getDatabase();

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://claude.ai', 'https://www.claude.ai'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'yahoo-fantasy-mcp',
    timestamp: new Date().toISOString(),
  });
});

// OAuth 2.1 routes
app.use(oauthRouter);

// MCP protocol routes
app.use(mcpRouter);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// Start server
app.listen(config.port, () => {
  console.log(`Yahoo Fantasy MCP server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Server URL: ${config.mcpServerUrl}`);

  // Initial cleanup
  cleanupExpiredRecords();
});
