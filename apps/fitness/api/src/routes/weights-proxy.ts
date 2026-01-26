import { Router, Request, Response } from 'express';

const router = Router();

const WEIGHTS_API_URL = process.env.WEIGHTS_API_URL || 'http://localhost:3003';

// Proxy to get PRs from weights-api (read-only)
router.get('/prs', async (req: Request, res: Response) => {
  try {
    const token = req.cookies.token;

    const response = await fetch(`${WEIGHTS_API_URL}/api/prs`, {
      method: 'GET',
      headers: {
        Cookie: `token=${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: 'Failed to fetch PRs from weights API' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error proxying to weights API:', error);
    res.status(500).json({ error: 'Failed to fetch PRs' });
  }
});

// Proxy to get exercises from weights-api (read-only)
router.get('/exercises', async (req: Request, res: Response) => {
  try {
    const token = req.cookies.token;

    const response = await fetch(`${WEIGHTS_API_URL}/api/exercises`, {
      method: 'GET',
      headers: {
        Cookie: `token=${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: 'Failed to fetch exercises from weights API' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error proxying to weights API:', error);
    res.status(500).json({ error: 'Failed to fetch exercises' });
  }
});

// Proxy to get PR history from weights-api (read-only)
router.get('/prs/history', async (req: Request, res: Response) => {
  try {
    const token = req.cookies.token;

    const response = await fetch(`${WEIGHTS_API_URL}/api/prs/history`, {
      method: 'GET',
      headers: {
        Cookie: `token=${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: 'Failed to fetch PR history from weights API' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error proxying to weights API:', error);
    res.status(500).json({ error: 'Failed to fetch PR history' });
  }
});

export { router as weightsProxyRoutes };
