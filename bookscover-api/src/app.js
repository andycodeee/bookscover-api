'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { ApiError } = require('./errors');
const publicRouter = require('./routes/public');
const gameRouter = require('./routes/game');
const adminRouter = require('./routes/admin');

function limiter(maxPerMinute) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: maxPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests, slow down' } },
  });
}

function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));

  // Game servers share a few IPs, so the game limit is generous.
  app.use('/v1/game', limiter(600), gameRouter);
  app.use('/v1/admin', limiter(120), adminRouter);
  app.use('/v1', limiter(120), publicRouter);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'payload_too_large', message: 'Body too large' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  });

  return app;
}

module.exports = { createApp };
