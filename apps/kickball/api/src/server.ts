import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { openDatabase } from './db';
import { requireManager } from './middleware/auth';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';

dotenv.config({ path: '/run/benloe-secrets/kickball.env' });

const PORT = Number(process.env.PORT || 3009);
const DB_PATH = process.env.KICKBALL_DB || '/srv/benloe/data/kickball.db';

const db = openDatabase(DB_PATH);
const app = express();

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin.includes('.benloe.com') || origin.includes('localhost')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'kickball-api' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'kickball-api' }));

app.use('/api/public', publicRoutes(db));
app.use('/api', requireManager(db), adminRoutes(db));

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`kickball-api listening on 127.0.0.1:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
