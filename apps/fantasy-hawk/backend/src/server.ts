import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { initDatabase } from './services/database';
import { oauthRoutes } from './routes/oauth';
import { fantasyRoutes } from './routes/fantasy';

// Load secrets from monorepo root
dotenv.config({ path: '/srv/benloe/.env' });

const app = express();
const PORT = process.env.PORT || 3005;

// Initialize database
initDatabase();

// Trust proxy for proper IP forwarding behind Caddy
app.set('trust proxy', true);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Handled by Caddy
  })
);

// CORS configuration - allow requests from benloe.com subdomains
app.use(
  cors({
    origin: function (origin, callback) {
      if (
        !origin ||
        origin === 'https://benloe.com' ||
        origin === 'http://benloe.com' ||
        origin.includes('.benloe.com') ||
        origin.includes('localhost')
      ) {
        callback(null, true);
      } else {
        console.log('CORS blocked origin:', origin);
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
app.use('/api/oauth', oauthRoutes);
app.use('/api/fantasy', fantasyRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'fantasy-hawk-api',
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(Number(PORT), '127.0.0.1', () => {
  console.log(`Fantasy Hawk API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
});
