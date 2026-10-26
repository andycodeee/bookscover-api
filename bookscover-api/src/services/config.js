'use strict';
const { query } = require('../db');

// Defaults used until an admin saves a config. Points are integers.
const DEFAULT_CONFIG = Object.freeze({
  afkPointsPerMinute: 10,
  minAwardSeconds: 30,
  maxAwardSeconds: 300,
  redemptionsEnabled: true,
});

// `db` may be the pool or a transaction client; both expose .query().
async function getConfig(db) {
  const runner = db || { query };
  const { rows } = await runner.query(`SELECT value FROM config WHERE key = 'game'`);
  return { ...DEFAULT_CONFIG, ...(rows[0]?.value || {}) };
}

async function setConfig(value) {
  await query(
    `INSERT INTO config (key, value, updated_at) VALUES ('game', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(value)]
  );
  return value;
}

module.exports = { DEFAULT_CONFIG, getConfig, setConfig };
