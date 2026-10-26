'use strict';
const { query, withTransaction } = require('../db');
const { ApiError } = require('../errors');
const { getConfig } = require('./config');

async function listInventory(playerId) {
  const { rows } = await query(
    `SELECT inv.item_id, it.name, it.price, inv.source, inv.acquired_at
       FROM inventory inv
       JOIN items it ON it.id = inv.item_id
      WHERE inv.player_id = $1
      ORDER BY inv.acquired_at ASC`,
    [playerId]
  );
  return rows.map((r) => ({
    itemId: r.item_id,
    name: r.name,
    price: Number(r.price),
    source: r.source,
    acquiredAt: r.acquired_at,
  }));
}

// Admin grant: free, no point cost.
async function grantItem(playerId, itemId, source = 'admin') {
  return withTransaction(async (db) => {
    const player = await db.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    if (!player.rows[0]) throw new ApiError(404, 'player_not_found', 'Player not found');

    const item = await db.query(`SELECT id, name FROM items WHERE id = $1`, [itemId]);
    if (!item.rows[0]) throw new ApiError(404, 'item_not_found', 'Item not found');

    const owned = await db.query(
      `SELECT 1 FROM inventory WHERE player_id = $1 AND item_id = $2`,
      [playerId, itemId]
    );
    if (owned.rows[0]) throw new ApiError(409, 'already_owned', 'Player already owns this item');

    await db.query(
      `INSERT INTO inventory (player_id, item_id, source) VALUES ($1, $2, $3)`,
      [playerId, itemId, source]
    );
    return { playerId, itemId, name: item.rows[0].name, source };
  });
}

// Player redemption: deducts points, grants the item, all atomically.
// Retries with the same idempotencyKey return the original result without charging twice.
async function redeemItem(playerId, itemId, idempotencyKey) {
  return withTransaction(async (db) => {
    const prior = await db.query(
      `SELECT player_id, item_id, points_remaining FROM redemptions WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    if (prior.rows[0]) {
      const p = prior.rows[0];
      if (p.player_id !== playerId || p.item_id !== itemId) {
        throw new ApiError(409, 'idempotency_key_reused', 'Idempotency-Key was used for a different request');
      }
      return {
        redeemed: true,
        replayed: true,
        itemId,
        pointsRemaining: Number(p.points_remaining),
      };
    }

    const cfg = await getConfig(db);
    if (!cfg.redemptionsEnabled) {
      throw new ApiError(503, 'redemptions_disabled', 'Redemptions are temporarily disabled');
    }

    // Lock the player row so concurrent redemptions cannot overspend.
    const player = await db.query(
      `SELECT banned, ban_reason, points FROM players WHERE id = $1 FOR UPDATE`,
      [playerId]
    );
    if (!player.rows[0]) throw new ApiError(404, 'player_not_found', 'Player not found');
    if (player.rows[0].banned) {
      throw new ApiError(403, 'banned', player.rows[0].ban_reason || 'This account is restricted');
    }

    const item = await db.query(
      `SELECT id, name, price, active FROM items WHERE id = $1`,
      [itemId]
    );
    if (!item.rows[0] || !item.rows[0].active) {
      throw new ApiError(404, 'item_unavailable', 'Item is not available');
    }

    const owned = await db.query(
      `SELECT 1 FROM inventory WHERE player_id = $1 AND item_id = $2`,
      [playerId, itemId]
    );
    if (owned.rows[0]) throw new ApiError(409, 'already_owned', 'You already own this item');

    const price = Number(item.rows[0].price);
    const balance = Number(player.rows[0].points);
    if (balance < price) {
      throw new ApiError(402, 'insufficient_points', `Need ${price} points, have ${balance}`);
    }

    const updated = await db.query(
      `UPDATE players SET points = points - $2, updated_at = now()
        WHERE id = $1 RETURNING points`,
      [playerId, price]
    );
    const remaining = Number(updated.rows[0].points);

    await db.query(
      `INSERT INTO inventory (player_id, item_id, source) VALUES ($1, $2, 'redeem')`,
      [playerId, itemId]
    );
    await db.query(
      `INSERT INTO point_ledger (player_id, delta, balance_after, reason)
       VALUES ($1, $2, $3, $4)`,
      [playerId, -price, remaining, `redeem:${itemId}`]
    );
    await db.query(
      `INSERT INTO redemptions (idempotency_key, player_id, item_id, points_remaining)
       VALUES ($1, $2, $3, $4)`,
      [idempotencyKey, playerId, itemId, remaining]
    );

    return { redeemed: true, replayed: false, itemId, pointsRemaining: remaining };
  });
}

module.exports = { listInventory, grantItem, redeemItem };
