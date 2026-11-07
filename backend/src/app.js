// src/app.js
// Express application — middleware stack + route mounting.
// No listen() here; that belongs in server.js (testability).

import express        from 'express';
import helmet         from 'helmet';
import cors           from 'cors';
import morgan         from 'morgan';
import cookieParser   from 'cookie-parser';
import { env }        from './config/env.js';
import { isAllowedOrigin } from './config/cors.js';
import apiRouter      from './routes.js';
import publicRoutes   from './modules/public/public.routes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());

const configuredOrigins = (env.corsOrigin || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin, configuredOrigins, env.nodeEnv === 'development')) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true, // Required for the httpOnly refresh cookie
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Logging ───────────────────────────────────────────────────────────────────
if (env.nodeEnv !== 'test') app.use(morgan(env.isDev ? 'dev' : 'combined'));

// ── Serverless URL normalization ──────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.url.startsWith('/api/index.js')) {
    req.url = req.url.replace('/api/index.js', '') || '/';
  }
  next();
});

// ── Health & Root ─────────────────────────────────────────────────────────────
app.get(['/', '/api', '/api/v1'], (req, res) => {
  res.json({
    status: 'ok',
    message: 'SalonOS API Server is running',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString()
  });
});

// ── Public Customer Receipts (Mounted at root so clicking localhost:5000 directly works) ─
app.use(['/receipt', '/r', '/public/receipt'], publicRoutes);

// ── API routes (Dual-mounted for standalone and Vercel serverless rewrites) ───
app.use(['/api/v1', '/v1'], apiRouter);

// ── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
