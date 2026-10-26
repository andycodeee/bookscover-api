'use strict';
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/asyncHandler');
const s = require('../schemas');
const players = require('../services/players');
const inventory = require('../services/inventory');
const items = require('../services/items');
const { getConfig, setConfig } = require('../services/config');

const router = express.Router();

// Every route here requires the ADMIN key.
router.use(requireAdmin);

// Points: POST adds a delta (can be negative), PATCH sets an absolute balance.
router.post(
  '/players/:id/points',
  validate(s.idParams, 'params'),
  validate(s.pointsDelta),
  asyncHandler(async (req, res) => {
    const { delta, reason } = req.validated.body;
    res.json(await players.adjustPoints(req.validated.params.id, delta, reason));
  })
);

router.patch(
  '/players/:id/points',
  validate(s.idParams, 'params'),
  validate(s.pointsSet),
  asyncHandler(async (req, res) => {
    const { points, reason } = req.validated.body;
    res.json(await players.setPoints(req.validated.params.id, points, reason));
  })
);

router.get(
  '/players/:id/inventory',
  validate(s.idParams, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ items: await inventory.listInventory(req.validated.params.id) });
  })
);

router.post(
  '/players/:id/inventory',
  validate(s.idParams, 'params'),
  validate(s.grantBody),
  asyncHandler(async (req, res) => {
    const granted = await inventory.grantItem(
      req.validated.params.id,
      req.validated.body.itemId,
      'admin'
    );
    res.status(201).json(granted);
  })
);

router.post(
  '/players/:id/ban',
  validate(s.idParams, 'params'),
  validate(s.banBody),
  asyncHandler(async (req, res) => {
    const { banned, reason } = req.validated.body;
    res.json(await players.setBan(req.validated.params.id, banned, reason));
  })
);

router.get(
  '/items',
  asyncHandler(async (req, res) => {
    res.json({ items: await items.listItems() });
  })
);

router.post(
  '/items',
  validate(s.itemCreate),
  asyncHandler(async (req, res) => {
    res.status(201).json(await items.createItem(req.validated.body));
  })
);

router.patch(
  '/items/:id',
  validate(s.idParams, 'params'),
  validate(s.itemUpdate),
  asyncHandler(async (req, res) => {
    res.json(await items.updateItem(req.validated.params.id, req.validated.body));
  })
);

router.get(
  '/config',
  asyncHandler(async (req, res) => {
    res.json(await getConfig());
  })
);

router.put(
  '/config',
  validate(s.gameConfig),
  asyncHandler(async (req, res) => {
    res.json(await setConfig(req.validated.body));
  })
);

module.exports = router;
