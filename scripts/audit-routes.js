#!/usr/bin/env node
// Audita todas las rutas del backend
// Uso: 1) npm start  2) (otro terminal) node scripts/audit-routes.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const BASE = `http://localhost:${process.env.PORT || 3001}`;

let passed = 0, failed = 0;

async function test(method, path, { body, token, expect: expectedStatus = 200, label } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    console.log(`❌  [CONN] ${method} ${path} — ${e.message}`);
    failed++;
    return null;
  }

  const status = res.status;
  let data;
  try { data = await res.json(); } catch { data = null; }

  const ok = status === expectedStatus;
  const tag = ok ? '✅' : '❌';
  const lbl = label ? ` (${label})` : '';
  console.log(`${tag}  ${method.padEnd(6)} ${path.padEnd(40)} → ${status}  expected ${expectedStatus}${lbl}`);
  if (!ok && data) console.log(`       ↳ ${JSON.stringify(data).slice(0, 140)}`);
  ok ? passed++ : failed++;
  return { status, data };
}

async function loginAs(email, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  return j?.session?.access_token || null;
}

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SeaPodADU — Route Audit');
  console.log(`  Target: ${BASE}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ── Health ──────────────────────────────────────────────────
  console.log('── Health ──────────────────────────────────────────────────');
  await test('GET', '/health');

  // ── Auth (unauthenticated) ───────────────────────────────────
  console.log('\n── Auth (unauthenticated expected to fail) ─────────────────');
  await test('GET',  '/auth/me',     { expect: 401 });
  await test('POST', '/auth/logout', { expect: 401 });
  await test('POST', '/auth/login',  { body: { email: 'x@x.com', password: 'wrong' }, expect: 401 });
  await test('POST', '/auth/login',  { body: {}, expect: 400, label: 'missing fields' });

  // ── Protected routes without token ──────────────────────────
  console.log('\n── Protected routes — no token (expect 401) ────────────────');
  await test('GET',   '/agents',        { expect: 401 });
  await test('GET',   '/agents/active', { expect: 401 });
  await test('POST',  '/agents',        { expect: 401 });
  await test('GET',   '/knocks',        { expect: 401 });
  await test('GET',   '/knocks/mine',   { expect: 401 });
  await test('POST',  '/knocks',        { expect: 401 });
  await test('GET',   '/events/latest', { expect: 401 });
  await test('GET',   '/reports/summary', { expect: 401 });
  await test('GET',   '/reports/export.csv', { expect: 401 });

  // ── Public routes (no auth) ──────────────────────────────────
  console.log('\n── Public routes (no auth) ─────────────────────────────────');
  await test('POST', '/public/consumer-submit', { body: {}, expect: 400, label: 'missing fields' });
  await test('POST', '/public/consumer-submit', {
    body: { address: '123 W Main St', name: 'Test User', phone: '6021234567', email: 'test@test.com' },
    expect: 200, label: 'valid (no agent match, still ok)',
  });
  await test('POST', '/public/geocode', { body: {}, expect: 400, label: 'missing q' });
  await test('POST', '/public/geocode', { body: { q: 'Phoenix AZ' }, label: 'geocode Phoenix' });
  await test('GET',  '/links/invalid-token-xyz', { expect: 404 });

  // ── Director auth ────────────────────────────────────────────
  console.log('\n── Director auth ────────────────────────────────────────────');
  const dirToken = await loginAs('director@seapodadu.com', 'Director123!');
  if (dirToken) {
    console.log('   ✓ Director login OK');
    await test('GET', '/auth/me',     { token: dirToken });
    await test('GET', '/agents',      { token: dirToken });
    await test('GET', '/agents/active', { token: dirToken });
    await test('GET', '/knocks',      { token: dirToken });
    await test('GET', '/reports/summary', { token: dirToken });
    await test('GET', '/reports/export.csv', { token: dirToken });

    // Agent with director token should fail agent-only routes
    await test('GET',  '/knocks/mine',   { token: dirToken, expect: 403, label: 'director on agent route' });
    await test('GET',  '/events/latest', { token: dirToken, expect: 403, label: 'director on agent route' });
    await test('POST', '/auth/logout',   { token: dirToken });
  } else {
    console.log('   ⚠  Director login FAILED — skipping director route tests');
    console.log('      Run: node scripts/setup-db.js  to seed demo accounts');
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
