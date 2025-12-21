const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join('/var/apps/data', 'dada.db');
const db = new sqlite3.Database(dbPath);

console.log('Initializing DADA database...');

db.serialize(() => {
  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS drills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      target_number TEXT,
      target_ring TEXT,
      throw_count INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      drill_id TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      throw_count INTEGER DEFAULT 0,
      hits INTEGER DEFAULT 0,
      accuracy REAL,
      total_score INTEGER DEFAULT 0,
      three_dart_avg REAL,
      FOREIGN KEY (drill_id) REFERENCES drills(id)
    );

    CREATE TABLE IF NOT EXISTS throws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      ring_type TEXT,
      score INTEGER NOT NULL,
      thrown_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS drill_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      drill_id TEXT NOT NULL,
      total_sessions INTEGER DEFAULT 0,
      total_throws INTEGER DEFAULT 0,
      total_hits INTEGER DEFAULT 0,
      avg_accuracy REAL,
      best_accuracy REAL,
      last_session_id INTEGER,
      sessions_since_practiced INTEGER DEFAULT 0,
      trend TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (drill_id) REFERENCES drills(id),
      UNIQUE(user_id, drill_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_drill_id ON sessions(drill_id);
    CREATE INDEX IF NOT EXISTS idx_throws_session_id ON throws(session_id);
    CREATE INDEX IF NOT EXISTS idx_drill_stats_user_id ON drill_stats(user_id);
  `, (err) => {
    if (err) {
      console.error('Error creating tables:', err);
      process.exit(1);
    }
    console.log('Tables created successfully.');

    // Insert default drills
    const drills = [
      {
        id: 'treble20',
        name: 'Treble 20 Focus',
        description: 'Throw at Treble 20. Track your accuracy.',
        category: 'accuracy',
        target_number: '20',
        target_ring: 'treble',
        throw_count: 10
      },
      {
        id: 'bullseye',
        name: 'Bullseye Practice',
        description: 'Hit the bull. Precision matters.',
        category: 'accuracy',
        target_number: 'bull',
        target_ring: 'double',
        throw_count: 10
      },
      {
        id: 'highScore',
        name: 'High Score Hunt',
        description: 'Score as high as possible. Go for trebles.',
        category: 'scoring',
        target_number: null,
        target_ring: null,
        throw_count: 9
      },
      {
        id: 'treble19',
        name: 'Treble 19 Focus',
        description: 'Second-highest treble. Essential backup target.',
        category: 'accuracy',
        target_number: '19',
        target_ring: 'treble',
        throw_count: 10
      },
      {
        id: 'treble18',
        name: 'Treble 18 Focus',
        description: 'Practice Treble 18 for scoring consistency.',
        category: 'accuracy',
        target_number: '18',
        target_ring: 'treble',
        throw_count: 10
      },
      {
        id: 'doublesTop',
        name: 'Double Top (D20)',
        description: 'Essential finishing double. Hit Double 20.',
        category: 'game-specific',
        target_number: '20',
        target_ring: 'double',
        throw_count: 10
      },
      {
        id: 'doubles16',
        name: 'Double 16 Practice',
        description: 'Common finish double. Practice accuracy.',
        category: 'game-specific',
        target_number: '16',
        target_ring: 'double',
        throw_count: 10
      },
      {
        id: 'aroundClock',
        name: 'Around the Clock',
        description: 'Hit 1-20 in sequence. Any ring counts.',
        category: 'endurance',
        target_number: null,
        target_ring: null,
        throw_count: 20
      }
    ];

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO drills (id, name, description, category, target_number, target_ring, throw_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    drills.forEach(drill => {
      stmt.run(
        drill.id,
        drill.name,
        drill.description,
        drill.category,
        drill.target_number,
        drill.target_ring,
        drill.throw_count
      );
    });

    stmt.finalize((err) => {
      if (err) {
        console.error('Error inserting drills:', err);
        process.exit(1);
      }

      console.log(`Inserted ${drills.length} default drills.`);
      console.log('Database initialization complete!');
      console.log(`Database location: ${dbPath}`);

      db.close();
    });
  });
});
