// src/config/env.js
// Centralised environment variable access — fail fast if critical vars are missing.

import 'dotenv/config';

const required = (key) => {
  const val = process.env[key];
  if (!val) {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.warn(`[WARN] Missing environment variable: ${key}. Configure this in your Vercel Project Settings.`);
      return '';
    }
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
};

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export const env = {
  port:              parseInt(process.env.PORT || '5000', 10),
  nodeEnv:           process.env.NODE_ENV || 'development',
  isDev:             process.env.NODE_ENV !== 'production',

  databaseUrl:       required('DATABASE_URL'),

  jwtAccessSecret:   process.env.JWT_ACCESS_SECRET || 'salonos_access_default_secret_2026',
  jwtRefreshSecret:  process.env.JWT_REFRESH_SECRET || 'salonos_refresh_default_secret_2026',
  jwtAccessExpires:  process.env.JWT_ACCESS_EXPIRES  || '7d',
  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',

  corsOrigin:        process.env.CORS_ORIGIN || 'http://localhost:3000',
  publicAppUrl:      process.env.PUBLIC_APP_URL || '',
  tz:                process.env.TZ           || 'Asia/Karachi',
};
