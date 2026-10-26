'use strict';
const crypto = require('crypto');
const config = require('../config');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

// Hash both sides so timingSafeEqual always gets equal-length buffers.
function keysMatch(provided, expected) {
  return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

function requireKey(expectedKey, label) {
  return (req, res, next) => {
    const token = bearerToken(req);
    if (!token || !keysMatch(token, expectedKey)) {
      return res.status(401).json({
        error: { code: 'unauthorized', message: `Missing or invalid ${label} API key` },
      });
    }
    next();
  };
}

module.exports = {
  requireAdmin: requireKey(config.adminApiKey, 'admin'),
  requireGame: requireKey(config.gameApiKey, 'game'),
};
