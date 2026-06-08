#!/usr/bin/env node
// Crea las tablas en Supabase vía Management API
// Uso: node scripts/setup-db.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.split('//')[1]?.split('.')[0];
const sqlPath = path.join(__dirname, '../sql/schema.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

async function runViaManagementAPI() {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function runViaRestRPC() {
  // Tries calling exec_sql RPC if it exists on the project
  const url = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function checkTablesExist() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.from('agents').select('id').limit(1);
  return !error;
}

async function main() {
  console.log('\n🔧  SeaPodADU — Database Setup');
  console.log(`    Project: ${PROJECT_REF}`);
  console.log(`    SQL:     ${sqlPath}\n`);

  // Check if already set up
  try {
    const exists = await checkTablesExist();
    if (exists) {
      console.log('✅  Tables already exist — skipping setup.\n');
      process.exit(0);
    }
  } catch (_) {}

  // Try Management API (needs a Supabase Personal Access Token, not service_role)
  console.log('⏳  Trying Supabase Management API…');
  let result = await runViaManagementAPI();
  if (result.ok) {
    console.log('✅  Tables created via Management API!\n');
    process.exit(0);
  }
  console.log(`    Management API → ${result.status}: ${result.body.slice(0, 120)}`);

  // Try exec_sql RPC
  console.log('⏳  Trying exec_sql RPC…');
  result = await runViaRestRPC();
  if (result.ok) {
    console.log('✅  Tables created via RPC!\n');
    process.exit(0);
  }
  console.log(`    RPC → ${result.status}: ${result.body.slice(0, 120)}\n`);

  // Manual fallback
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋  SETUP MANUAL REQUERIDO');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`1. Abre: https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
  console.log(`2. Copia y pega el contenido de: sql/schema.sql`);
  console.log('3. Haz clic en "Run"\n');
  process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
