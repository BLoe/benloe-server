import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { authenticate } from './middleware/auth';
import { profileRoutes } from './routes/profile';
import { workoutRoutes } from './routes/workouts';
import { exerciseRoutes } from './routes/exercises';
import { completionRoutes } from './routes/completions';
import { metricRoutes } from './routes/metrics';
import { milestoneRoutes } from './routes/milestones';
import { chatRoutes } from './routes/chat';
import { weightsProxyRoutes } from './routes/weights-proxy';

dotenv.config({ path: '/srv/benloe/.env' });

const app = express();
const PORT = process.env.PORT || 3007;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      if (
        !origin ||
        origin === 'https://benloe.com' ||
        origin === 'https://fitness.benloe.com' ||
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

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fitness-api' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fitness-api' });
});

// Protected routes
app.use('/api/profile', authenticate, profileRoutes);
app.use('/api/workouts', authenticate, workoutRoutes);
app.use('/api/exercises', authenticate, exerciseRoutes);
app.use('/api/completions', authenticate, completionRoutes);
app.use('/api/metrics', authenticate, metricRoutes);
app.use('/api/milestones', authenticate, milestoneRoutes);
app.use('/api/chat', authenticate, chatRoutes);
app.use('/api/weights', authenticate, weightsProxyRoutes);

// User info endpoint
app.get('/api/user/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`Fitness API running on port ${PORT}`);
});

export default app;
