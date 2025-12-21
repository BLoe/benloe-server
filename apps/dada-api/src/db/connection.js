const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db = null;

async function getDb() {
  if (db) return db;

  db = await open({
    filename: path.join('/var/apps/data', 'dada.db'),
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec('PRAGMA journal_mode = WAL');

  return db;
}

module.exports = { getDb };
