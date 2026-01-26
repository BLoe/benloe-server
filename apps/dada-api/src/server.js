const express = require('express');
const cors = require('cors');
const { getDb } = require('./db/connection');

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(cors({
  origin: ['https://dada.benloe.com', 'https://api.dada.benloe.com', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Simple user extraction middleware (assumes Artanis handles auth)
// In production, this would verify the session cookie
app.use((req, res, next) => {
  // For now, use a default user ID
  // TODO: Extract from Artanis session cookie
  req.userId = 1;
  next();
});

// ==================== DRILLS ====================

// GET /api/drills - Get all drills
app.get('/api/drills', async (req, res) => {
  try {
    const db = await getDb();
    const drills = await db.all('SELECT * FROM drills ORDER BY category, name');
    res.json(drills);
  } catch (error) {
    console.error('Error fetching drills:', error);
    res.status(500).json({ error: 'Failed to fetch drills' });
  }
});

// GET /api/drills/recommended - Get recommended drill using spaced repetition
// IMPORTANT: This must come BEFORE /api/drills/:drillId to avoid matching "recommended" as a drillId
app.get('/api/drills/recommended', async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.userId;

    // Get all drills with their stats
    const drillsWithStats = await db.all(`
      SELECT
        d.*,
        COALESCE(ds.avg_accuracy, 0) as avg_accuracy,
        COALESCE(ds.sessions_since_practiced, 999) as sessions_since_practiced,
        COALESCE(ds.total_sessions, 0) as total_sessions
      FROM drills d
      LEFT JOIN drill_stats ds ON d.id = ds.drill_id AND ds.user_id = ?
      ORDER BY d.id
    `, userId);

    if (drillsWithStats.length === 0) {
      return res.status(404).json({ error: 'No drills available' });
    }

    // Spaced repetition algorithm
    const sessionHistory = await db.all(`
      SELECT drill_id FROM sessions
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT 3
    `, userId);

    const recentDrillIds = sessionHistory.map(s => s.drill_id);

    const scoredDrills = drillsWithStats.map(drill => {
      // Performance score (50%) - lower accuracy = higher priority
      const performanceScore = drill.total_sessions > 0
        ? ((100 - drill.avg_accuracy) / 100) * 0.5
        : 0.25; // New drills get medium priority

      // Recency score (30%) - longer since practiced = higher priority
      const recencyScore = Math.min(drill.sessions_since_practiced / 5, 1.0) * 0.3;

      // Variety score (20%) - base variety score
      const varietyScore = 0.1;

      // Penalty for recently practiced
      const recentPenalty = recentDrillIds.includes(drill.id) ? 0.3 : 0;

      const totalScore = performanceScore + recencyScore + varietyScore - recentPenalty;

      return {
        ...drill,
        scores: {
          performance: performanceScore,
          recency: recencyScore,
          variety: varietyScore,
          penalty: recentPenalty,
          total: totalScore
        }
      };
    });

    // Sort by total score (highest first)
    scoredDrills.sort((a, b) => b.scores.total - a.scores.total);

    const recommended = scoredDrills[0];

    // Generate reason
    let reason = '';
    if (recommended.total_sessions === 0) {
      reason = "You haven't tried this drill yet.";
    } else if (recommended.sessions_since_practiced > 5) {
      reason = `You haven't practiced this in ${recommended.sessions_since_practiced} sessions.`;
    } else if (recommended.avg_accuracy < 50) {
      reason = `Your accuracy (${Math.round(recommended.avg_accuracy)}%) needs improvement.`;
    } else {
      reason = 'Time to practice this again.';
    }

    res.json({
      drill: {
        id: recommended.id,
        name: recommended.name,
        description: recommended.description,
        category: recommended.category,
        target_number: recommended.target_number,
        target_ring: recommended.target_ring,
        throw_count: recommended.throw_count
      },
      reason,
      stats: {
        avg_accuracy: recommended.avg_accuracy,
        sessions_since_practiced: recommended.sessions_since_practiced,
        total_sessions: recommended.total_sessions
      },
      alternatives: scoredDrills.slice(1, 4).map(d => ({
        id: d.id,
        name: d.name,
        category: d.category
      }))
    });
  } catch (error) {
    console.error('Error getting recommended drill:', error);
    res.status(500).json({ error: 'Failed to get recommendation' });
  }
});

// GET /api/drills/:drillId - Get specific drill
app.get('/api/drills/:drillId', async (req, res) => {
  try {
    const db = await getDb();
    const drill = await db.get('SELECT * FROM drills WHERE id = ?', req.params.drillId);
    if (!drill) {
      return res.status(404).json({ error: 'Drill not found' });
    }
    res.json(drill);
  } catch (error) {
    console.error('Error fetching drill:', error);
    res.status(500).json({ error: 'Failed to fetch drill' });
  }
});

// ==================== SESSIONS ====================

// POST /api/sessions - Start new session
app.post('/api/sessions', async (req, res) => {
  try {
    const db = await getDb();
    const { drillId } = req.body;
    const userId = req.userId;

    // Verify drill exists
    const drill = await db.get('SELECT * FROM drills WHERE id = ?', drillId);
    if (!drill) {
      return res.status(404).json({ error: 'Drill not found' });
    }

    // Increment sessions_since_practiced for all other drills
    await db.run(`
      UPDATE drill_stats
      SET sessions_since_practiced = sessions_since_practiced + 1
      WHERE user_id = ? AND drill_id != ?
    `, userId, drillId);

    // Create session
    const result = await db.run(`
      INSERT INTO sessions (user_id, drill_id)
      VALUES (?, ?)
    `, userId, drillId);

    const session = await db.get('SELECT * FROM sessions WHERE id = ?', result.lastID);

    res.json(session);
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /api/sessions/:sessionId - Get session details
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.userId;
    const session = await db.get(`
      SELECT s.*, d.name as drill_name, d.category, d.target_number, d.target_ring
      FROM sessions s
      JOIN drills d ON s.drill_id = d.id
      WHERE s.id = ? AND s.user_id = ?
    `, req.params.sessionId, userId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const throws = await db.all('SELECT * FROM throws WHERE session_id = ? ORDER BY thrown_at', session.id);

    res.json({
      ...session,
      throws
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// POST /api/sessions/:sessionId/throws - Record a throw
app.post('/api/sessions/:sessionId/throws', async (req, res) => {
  try {
    const db = await getDb();
    const { sessionId } = req.params;
    const { number, ringType, score } = req.body;
    const userId = req.userId;

    // Verify session exists and belongs to user
    const session = await db.get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', sessionId, userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get drill info
    const drill = await db.get('SELECT * FROM drills WHERE id = ?', session.drill_id);

    // Insert throw
    const result = await db.run(`
      INSERT INTO throws (session_id, number, ring_type, score)
      VALUES (?, ?, ?, ?)
    `, sessionId, number, ringType, score);

    // Update session stats
    const throws = await db.all('SELECT * FROM throws WHERE session_id = ?', sessionId);
    const throwCount = throws.length;
    const totalScore = throws.reduce((sum, t) => sum + t.score, 0);
    const threeDartAvg = (totalScore / throwCount) * 3;

    // Calculate hits if drill has target
    let hits = 0;
    if (drill.target_number && drill.target_ring) {
      hits = throws.filter(t =>
        t.number === drill.target_number && t.ring_type === drill.target_ring
      ).length;
    }

    const accuracy = throwCount > 0 ? (hits / throwCount) * 100 : 0;

    await db.run(`
      UPDATE sessions
      SET throw_count = ?, hits = ?, total_score = ?, three_dart_avg = ?, accuracy = ?
      WHERE id = ?
    `, throwCount, hits, totalScore, threeDartAvg, accuracy, sessionId);

    const throw_ = await db.get('SELECT * FROM throws WHERE id = ?', result.lastID);

    res.json({
      throw: throw_,
      sessionStats: {
        throwCount,
        hits,
        accuracy,
        totalScore,
        threeDartAvg
      }
    });
  } catch (error) {
    console.error('Error recording throw:', error);
    res.status(500).json({ error: 'Failed to record throw' });
  }
});

// PATCH /api/sessions/:sessionId/complete - Complete a session
app.patch('/api/sessions/:sessionId/complete', async (req, res) => {
  try {
    const db = await getDb();
    const { sessionId } = req.params;
    const userId = req.userId;

    // Get session
    const session = await db.get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', sessionId, userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Mark as completed
    await db.run('UPDATE sessions SET completed_at = CURRENT_TIMESTAMP WHERE id = ?', sessionId);

    // Update drill_stats
    const existingStats = await db.get(`
      SELECT * FROM drill_stats WHERE user_id = ? AND drill_id = ?
    `, userId, session.drill_id);

    if (existingStats) {
      // Calculate new averages
      const newTotalSessions = existingStats.total_sessions + 1;
      const newTotalThrows = existingStats.total_throws + session.throw_count;
      const newTotalHits = existingStats.total_hits + session.hits;
      const newAvgAccuracy = (newTotalHits / newTotalThrows) * 100;
      const newBestAccuracy = Math.max(existingStats.best_accuracy, session.accuracy);

      // Determine trend (simple: compare last 3 sessions)
      const recentSessions = await db.all(`
        SELECT accuracy FROM sessions
        WHERE user_id = ? AND drill_id = ? AND completed_at IS NOT NULL
        ORDER BY completed_at DESC
        LIMIT 3
      `, userId, session.drill_id);

      let trend = 'stable';
      if (recentSessions.length >= 2) {
        const avgRecent = recentSessions.reduce((sum, s) => sum + s.accuracy, 0) / recentSessions.length;
        if (avgRecent > existingStats.avg_accuracy + 5) trend = 'improving';
        else if (avgRecent < existingStats.avg_accuracy - 5) trend = 'declining';
      }

      await db.run(`
        UPDATE drill_stats
        SET total_sessions = ?,
            total_throws = ?,
            total_hits = ?,
            avg_accuracy = ?,
            best_accuracy = ?,
            last_session_id = ?,
            sessions_since_practiced = 0,
            trend = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND drill_id = ?
      `,
        newTotalSessions,
        newTotalThrows,
        newTotalHits,
        newAvgAccuracy,
        newBestAccuracy,
        sessionId,
        trend,
        userId,
        session.drill_id
      );
    } else {
      // Create new stats
      const accuracy = session.throw_count > 0 ? (session.hits / session.throw_count) * 100 : 0;

      await db.run(`
        INSERT INTO drill_stats (
          user_id, drill_id, total_sessions, total_throws, total_hits,
          avg_accuracy, best_accuracy, last_session_id, sessions_since_practiced, trend
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 0, 'new')
      `,
        userId,
        session.drill_id,
        session.throw_count,
        session.hits,
        accuracy,
        accuracy,
        sessionId
      );
    }

    const updatedSession = await db.get('SELECT * FROM sessions WHERE id = ?', sessionId);
    res.json(updatedSession);
  } catch (error) {
    console.error('Error completing session:', error);
    res.status(500).json({ error: 'Failed to complete session' });
  }
});

// GET /api/sessions - Get session history
app.get('/api/sessions', async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 20;

    const sessions = await db.all(`
      SELECT s.*, d.name as drill_name, d.category
      FROM sessions s
      JOIN drills d ON s.drill_id = d.id
      WHERE s.user_id = ?
      ORDER BY s.started_at DESC
      LIMIT ?
    `, userId, limit);

    res.json(sessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ==================== STATS ====================

// GET /api/stats/overall - Get overall stats
app.get('/api/stats/overall', async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.userId;

    const overall = await db.get(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(throw_count) as total_throws,
        AVG(three_dart_avg) as avg_3da,
        MAX(three_dart_avg) as best_3da
      FROM sessions
      WHERE user_id = ? AND completed_at IS NOT NULL
    `, userId);

    // Get last 10 sessions for trend
    const recentSessions = await db.all(`
      SELECT three_dart_avg, completed_at
      FROM sessions
      WHERE user_id = ? AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 10
    `, userId);

    res.json({
      ...overall,
      recentSessions
    });
  } catch (error) {
    console.error('Error fetching overall stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/stats/drills/:drillId - Get drill-specific stats
app.get('/api/stats/drills/:drillId', async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.userId;
    const { drillId } = req.params;

    const stats = await db.get(`
      SELECT * FROM drill_stats
      WHERE user_id = ? AND drill_id = ?
    `, userId, drillId);

    if (!stats) {
      return res.json({
        total_sessions: 0,
        total_throws: 0,
        total_hits: 0,
        avg_accuracy: 0,
        best_accuracy: 0,
        sessions_since_practiced: 0,
        trend: 'new'
      });
    }

    // Get recent sessions for this drill
    const recentSessions = await db.all(`
      SELECT id, accuracy, three_dart_avg, completed_at, throw_count
      FROM sessions
      WHERE user_id = ? AND drill_id = ? AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 10
    `, userId, drillId);

    res.json({
      ...stats,
      recentSessions
    });
  } catch (error) {
    console.error('Error fetching drill stats:', error);
    res.status(500).json({ error: 'Failed to fetch drill stats' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`DADA API server running on port ${PORT}`);
});
