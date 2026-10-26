'use strict';
const { z } = require('zod');

const robloxId = z.string().regex(/^\d{1,20}$/, 'must be a numeric Roblox id');
const reasonText = z.string().trim().min(1).max(200);

const idParams = z.object({ id: robloxId });

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const leaderboardQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const sessionBody = z.object({
  username: z.string().trim().min(1).max(50),
});

const gameStateBody = z.object({
  username: z.string().trim().min(1).max(50),
  points: z.number().finite().min(0).max(1_000_000_000_000),
  stage: z.number().int().min(1).max(1_000_000),
  groupRewardClaimed: z.boolean(),
  pointsMultiplier: z.number().finite().min(1).max(1_000),
  boosts: z.array(z.object({
    multiplier: z.number().finite().min(1).max(100),
    expiresAt: z.number().int().min(0).max(9_999_999_999),
  })).max(20),
});

const redeemBody = z.object({
  itemId: robloxId,
});

const pointsDelta = z.object({
  delta: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  reason: reasonText,
});

const pointsSet = z.object({
  points: z.number().int().min(0).max(1_000_000_000_000),
  reason: reasonText,
});

const banBody = z.object({
  banned: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});

const grantBody = z.object({
  itemId: robloxId,
});

const itemCreate = z.object({
  id: robloxId,
  name: z.string().trim().min(1).max(100),
  price: z.number().int().min(0).max(1_000_000_000),
  active: z.boolean().default(true),
});

const itemUpdate = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    price: z.number().int().min(0).max(1_000_000_000).optional(),
    active: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

const gameConfig = z
  .object({
    afkPointsPerMinute: z.number().int().min(0).max(10_000),
    minAwardSeconds: z.number().int().min(1).max(3600),
    maxAwardSeconds: z.number().int().min(1).max(3600),
    redemptionsEnabled: z.boolean(),
  })
  .refine((c) => c.minAwardSeconds <= c.maxAwardSeconds, {
    message: 'minAwardSeconds must be <= maxAwardSeconds',
  });

module.exports = {
  idParams,
  pagination,
  leaderboardQuery,
  sessionBody,
  gameStateBody,
  redeemBody,
  pointsDelta,
  pointsSet,
  banBody,
  grantBody,
  itemCreate,
  itemUpdate,
  gameConfig,
};
