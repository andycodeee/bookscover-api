'use strict';
require('dotenv').config();

function requireEnv(name, minLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(`Missing or too-short environment variable: ${name} (min ${minLength} chars)`);
  }
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: requireEnv('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL !== 'false',
  adminApiKey: requireEnv('ADMIN_API_KEY', 32),
  gameApiKey: requireEnv('GAME_API_KEY', 32),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
};

if (config.adminApiKey === config.gameApiKey) {
  throw new Error('ADMIN_API_KEY and GAME_API_KEY must be different values');
}

module.exports = Object.freeze(config);
