'use strict';
const { query, withTransaction } = require('../db');
const { ApiError, bannedError } = require('../errors');
const { getConfig } = require('./config');
const { listInventory } = require('./inventory');

function formatPlayer(row) {
  return {
    id: row.id,
    username: row.username,
    points: Number(row.points),
    stage: Number(row.stage || 1),
    gameState: row.game_state || {},
    banned: row.banned,
    createdAt: row.created_at,
  };
}

async function listPlayers({ limit, offset }) {
  const { rows } = await query(
    `SELECT id, username, points, stage FROM players
      WHERE NOT banned
      ORDER BY id ASC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    points: Number(r.points),
    stage: Number(r.stage || 1),
  }));
}

async function getPlayer(id) {
  const { rows } = await query(
    `SELECT id, username, points, stage, game_state, banned, created_at FROM players WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'player_not_found', 'Player not found');
  return { ...formatPlayer(rows[0]), inventory: await listInventory(id) };
}

// The Roblox ProfileStore remains authoritative. This endpoint mirrors a server-side
// snapshot so public player views and leaderboards match the live game.
async function syncGameState(id, state) {
  return withTransaction(async (db) => {
    const existing = await db.query(
      `SELECT points, banned, ban_reason FROM players WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (existing.rows[0]?.banned) throw bannedError(existing.rows[0].ban_reason);

    const gameState = {
      groupRewardClaimed: state.groupRewardClaimed,
      pointsMultiplier: state.pointsMultiplier,
      boosts: state.boosts,
    };

    if (!existing.rows[0]) {
      await db.query(
        `INSERT INTO players (id, username, points, stage, game_state, last_award_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [id, state.username, state.points, state.stage, JSON.stringify(gameState)]
      );
      if (state.points > 0) {
        await db.query(
          `INSERT INTO point_ledger (player_id, delta, balance_after, reason)
           VALUES ($1, $2, $3, 'game_sync')`,
          [id, state.points, state.points]
        );
      }
    } else {
      const previousPoints = Number(existing.rows[0].points);
      const delta = state.points - previousPoints;
      await db.query(
        `UPDATE players
            SET username = $2, points = $3, stage = $4, game_state = $5,
                last_award_at = now(), updated_at = now()
          WHERE id = $1`,
        [id, state.username, state.points, state.stage, JSON.stringify(gameState)]
      );
      if (delta !== 0) {
        await db.query(
          `INSERT INTO point_ledger (player_id, delta, balance_after, reason)
           VALUES ($1, $2, $3, 'game_sync')`,
          [id, delta, state.points]
        );
      }
    }

    return {
      id,
      username: state.username,
      points: state.points,
      stage: state.stage,
      gameState,
      synced: true,
    };
  });
}

// Called when a player joins a server. Creates the player on first contact.
async function startSession(id, username) {
  return withTransaction(async (db) => {
    const existing = await db.query(
      `SELECT banned, ban_reason FROM players WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (existing.rows[0]?.banned) throw bannedError(existing.rows[0].ban_reason);

    const { rows } = await db.query(
      `INSERT INTO players (id, username, last_award_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE
         SET username = EXCLUDED.username, last_award_at = now(), updated_at = now()
       RETURNING id, username, points, banned, created_at`,
      [id, username]
    );
    return formatPlayer(rows[0]);
  });
}

// AFK accrual. The client sends NO amounts: the server measures elapsed time
// since the last award using its own clock and caps it, so a client cannot inflate points.
async function awardAfk(id) {
  return withTransaction(async (db) => {
    const cfg = await getConfig(db);

    const { rows } = await db.query(
      `SELECT banned, ban_reason, points, (last_award_at IS NULL) AS never_seen,
              LEAST(
                GREATEST(EXTRACT(EPOCH FROM (now() - last_award_at))::float8, 0),
                $2::float8
              ) AS seconds
         FROM players WHERE id = $1 FOR UPDATE`,
      [id, cfg.maxAwardSeconds]
    );
    const p = rows[0];
    if (!p) throw new ApiError(404, 'player_not_found', 'Call /session before /afk');
    if (p.banned) throw bannedError(p.ban_reason);

    if (p.never_seen) {
      await db.query(`UPDATE players SET last_award_at = now() WHERE id = $1`, [id]);
      return { awarded: 0, points: Number(p.points), reason: 'session_started' };
    }

    const seconds = Number(p.seconds);
    if (seconds < cfg.minAwardSeconds) {
      // Too soon. Leave last_award_at alone so the time keeps accumulating.
      return { awarded: 0, points: Number(p.points), reason: 'too_soon' };
    }

    const awarded = Math.floor((seconds / 60) * cfg.afkPointsPerMinute);
    const updated = await db.query(
      `UPDATE players
          SET points = points + $2,
              total_afk_seconds = total_afk_seconds + $3,
              last_award_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING points`,
      [id, awarded, Math.floor(seconds)]
    );
    const balance = Number(updated.rows[0].points);

    if (awarded > 0) {
      await db.query(
        `INSERT INTO point_ledger (player_id, delta, balance_after, reason)
         VALUES ($1, $2, $3, 'afk')`,
        [id, awarded, balance]
      );
    }
    return { awarded, points: balance, reason: 'ok' };
  });
}

// Shared by admin adjust and set. Locks the row and writes a ledger entry.
async function changePoints(id, computeNext, reason) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(`SELECT points FROM players WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new ApiError(404, 'player_not_found', 'Player not found');

    const current = Number(rows[0].points);
    const next = computeNext(current);
    if (next < 0) {
      throw new ApiError(409, 'insufficient_points', `Balance would go negative (current ${current})`);
    }
    const delta = next - current;

    await db.query(`UPDATE players SET points = $2, updated_at = now() WHERE id = $1`, [id, next]);
    await db.query(
      `INSERT INTO point_ledger (player_id, delta, balance_after, reason)
       VALUES ($1, $2, $3, $4)`,
      [id, delta, next, reason]
    );
    return { id, points: next, delta };
  });
}

const adjustPoints = (id, delta, reason) => changePoints(id, (c) => c + delta, reason);
const setPoints = (id, value, reason) => changePoints(id, () => value, reason);

async function setBan(id, banned, reason) {
  const { rows } = await query(
    `UPDATE players
        SET banned = $2, ban_reason = $3, updated_at = now()
      WHERE id = $1
      RETURNING id, banned, ban_reason`,
    [id, banned, banned ? (reason || 'Banned') : null]
  );
  if (!rows[0]) throw new ApiError(404, 'player_not_found', 'Player not found');
  return { id: rows[0].id, banned: rows[0].banned, banReason: rows[0].ban_reason };
}

async function leaderboard(limit) {
  const { rows } = await query(
    `SELECT id, username, points, stage FROM players
      WHERE NOT banned
      ORDER BY points DESC, id ASC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    id: r.id,
    username: r.username,
    points: Number(r.points),
    stage: Number(r.stage || 1),
  }));
}

module.exports = {
  listPlayers,
  getPlayer,
  startSession,
  syncGameState,
  awardAfk,
  adjustPoints,
  setPoints,
  setBan,
  leaderboard,
};
