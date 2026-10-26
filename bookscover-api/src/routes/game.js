'use strict';
const express = require('express');
const { requireGame } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/asyncHandler');
const { ApiError } = require('../errors');
const s = require('../schemas');
const players = require('../services/players');
const inventory = require('../services/inventory');

const router = express.Router();
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

// Every route here requires the GAME key. Players never hold it.
router.use(requireGame);

router.post(
  '/players/:id/session',
  validate(s.idParams, 'params'),
  validate(s.sessionBody),
  asyncHandler(async (req, res) => {
    const player = await players.startSession(
      req.validated.params.id,
      req.validated.body.username
    );
    res.json(player);
  })
);

router.post(
  '/players/:id/state',
  validate(s.idParams, 'params'),
  validate(s.gameStateBody),
  asyncHandler(async (req, res) => {
    res.json(await players.syncGameState(req.validated.params.id, req.validated.body));
  })
);

router.post(
  '/players/:id/afk',
  validate(s.idParams, 'params'),
  asyncHandler(async (req, res) => {
    res.json(await players.awardAfk(req.validated.params.id));
  })
);

router.post(
  '/players/:id/redeem',
  validate(s.idParams, 'params'),
  validate(s.redeemBody),
  asyncHandler(async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || !IDEMPOTENCY_KEY_RE.test(key)) {
      throw new ApiError(400, 'idempotency_key_required',
        'Send an Idempotency-Key header (8-100 chars: letters, digits, _ or -)');
    }
    const result = await inventory.redeemItem(
      req.validated.params.id,
      req.validated.body.itemId,
      key
    );
    res.json(result);
  })
);

module.exports = router;
