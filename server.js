require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes    = require('./routes/auth');
const agentRoutes   = require('./routes/agents');
const knockRoutes   = require('./routes/knocks');
const linkRoutes    = require('./routes/links');
const publicRoutes  = require('./routes/public');
const eventRoutes   = require('./routes/events');
const reportRoutes  = require('./routes/reports');
const devRoutes     = require('./routes/dev');

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));

// Global rate limit
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

// Tighter limit for public consumer endpoint
const publicLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'Too many submissions, try again later' } });

app.use('/auth',    authRoutes);
app.use('/agents',  agentRoutes);
app.use('/knocks',  knockRoutes);
app.use('/links',   linkRoutes);
app.use('/events',  eventRoutes);
app.use('/reports', reportRoutes);
app.use('/public',  publicLimiter, publicRoutes);

if (process.env.NODE_ENV !== 'production') {
  app.use('/dev', devRoutes);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// 404
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler — maps Supabase/PostgREST errors to proper HTTP codes
app.use((err, _req, res, _next) => {
  const msg = err.message || String(err) || 'Internal server error';

  // PostgREST "table not in schema cache" → 503 (DB not yet configured)
  if (msg.includes('schema cache') || msg.includes('does not exist')) {
    return res.status(503).json({ error: 'Database not yet configured — run sql/schema.sql in Supabase' });
  }
  // PostgREST "row not found" on RLS
  if (err.code === 'PGRST116') return res.status(404).json({ error: 'Not found' });
  // PostgREST auth errors
  if (err.code === 'PGRST301') return res.status(401).json({ error: 'Unauthorized' });

  const status = err.status || err.statusCode || 500;
  console.error(`[${new Date().toISOString()}] ${status} ${msg}`);
  res.status(status).json({ error: msg });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SeaPodADU backend running on http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
