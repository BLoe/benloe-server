import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';

import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { gameRoutes } from './routes/games-production';
import { eventRoutes } from './routes/events-production';
import { calendarRoutes } from './routes/calendar';
import './services/databaseService'; // Initialize database

const app = express();
const PORT = process.env['PORT'] || 3001;

// Trust proxy for Express when behind Caddy reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || '900000'), // 15 minutes
  max: parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] || '100'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// CORS configuration for cross-service communication
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests from benloe.com subdomains and localhost
      if (
        !origin ||
        origin.includes('.benloe.com') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/calendar', calendarRoutes);

// Default route
app.get('/api', (_req, res) => {
  res.json({
    service: 'gamenight-api',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: process.env['NODE_ENV'] === 'production' ? 'Internal server error' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`🎲 Game Night API running on port ${PORT}`);
});

export default app;
