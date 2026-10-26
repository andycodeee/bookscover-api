'use strict';
const express = require('express');
const { pool } = require('../db');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/asyncHandler');
const s = require('../schemas');
const players = require('../services/players');
const { listItems } = require('../services/items');
const { getConfig } = require('../services/config');

const router = express.Router();

router.get(
  '/health',
  asyncHandler(async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'up', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  })
);

router.get(
  '/config',
  asyncHandler(async (req, res) => {
    res.json({
      config: await getConfig(),
      items: await listItems({ activeOnly: true }),
    });
  })
);

router.get(
  '/players',
  validate(s.pagination, 'query'),
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.validated.query;
    res.json({ players: await players.listPlayers({ limit, offset }), limit, offset });
  })
);

router.get(
  '/players/:id',
  validate(s.idParams, 'params'),
  asyncHandler(async (req, res) => {
    res.json(await players.getPlayer(req.validated.params.id));
  })
);

router.get(
  '/leaderboards',
  validate(s.leaderboardQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ leaderboard: await players.leaderboard(req.validated.query.limit) });
  })
);

module.exports = router;
