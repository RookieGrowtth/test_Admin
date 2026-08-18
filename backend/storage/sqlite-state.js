/**
 * SQLite-backed aggregate state repository.
 *
 * The current MVP stores one JSON aggregate in SQLite to keep deployment tiny.
 * Feature services receive this repository instead of opening SQLite themselves,
 * so each aggregate can later move to normalized tables without changing routes.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function createSqliteStateRepository({ dataDir, databaseFile, legacyDataFile, createSeed }) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(databaseFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);');
  const save = (state) => db.prepare('INSERT OR REPLACE INTO app_state (id, payload, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(state), new Date().toISOString());
  const stored = db.prepare('SELECT payload FROM app_state WHERE id = 1').get();
  let state;
  if (stored) { try { state = JSON.parse(stored.payload); } catch { state = null; } }
  if (!state) {
    state = createSeed();
    if (existsSync(legacyDataFile)) { try { state = JSON.parse(readFileSync(legacyDataFile, 'utf8')); } catch { /* Start from seed. */ } }
    save(state);
  }
  return { getState: () => state, save, close: () => db.close() };
}
