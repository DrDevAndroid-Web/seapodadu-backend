const { Router } = require('express');
const { supabaseAdmin } = require('../lib/supabase');

const router = Router();

const DEMO_AGENTS = [
  { id: '202501001', name: 'Carlos Ramírez',   email: 'carlos@demo.seapodadu.com', phone: '6021112233' },
  { id: '202501002', name: 'Sofía Martínez',   email: 'sofia@demo.seapodadu.com',  phone: '6024445566' },
  { id: '202501003', name: 'Diego López',      email: 'diego@demo.seapodadu.com',  phone: '6027778899' },
  { id: '202501004', name: 'Lucía Hernández',  email: 'lucia@demo.seapodadu.com',  phone: '6020001122' },
];

const STATES = ['No Atendido', 'No Interesado', 'Interesado', 'Cita'];
const CITIES = ['Phoenix', 'Mesa', 'Chandler', 'Gilbert', 'Tucson'];
const rand = arr => arr[Math.floor(Math.random() * arr.length)];

async function ensureAgent(agent) {
  const { data: existing } = await supabaseAdmin
    .from('agents').select('id').eq('id', agent.id).maybeSingle();
  if (existing) return;

  // Delete existing auth user with same email if any
  const { data: users } = await supabaseAdmin.auth.admin.listUsers();
  const existing_user = users?.users?.find(u => u.email === agent.email);
  if (existing_user) {
    await supabaseAdmin.auth.admin.deleteUser(existing_user.id).catch(() => {});
  }

  const { data: authData } = await supabaseAdmin.auth.admin.createUser({
    email: agent.email, password: 'Demo123!', email_confirm: true,
  });
  if (!authData?.user) return;

  await supabaseAdmin.from('agents').insert({ ...agent, user_id: authData.user.id, active: true });
  await supabaseAdmin.from('user_roles').insert({ user_id: authData.user.id, role: 'agente' });
}

// POST /dev/reset-demo
router.post('/reset-demo', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }

    const agentIds = DEMO_AGENTS.map(a => a.id);
    await supabaseAdmin.from('door_knocks').delete().in('agent_id', agentIds);
    await supabaseAdmin.from('match_events').delete().in('agent_id', agentIds);

    for (const agent of DEMO_AGENTS) await ensureAgent(agent);

    const now = Date.now();
    const knocks = Array.from({ length: 480 }, (_, i) => {
      const agent = rand(DEMO_AGENTS);
      const daysAgo = Math.floor(Math.random() * 28);
      const state = rand(STATES);
      const timestamp = new Date(now - daysAgo * 86_400_000 - Math.random() * 28_800_000).toISOString();
      const hasLead = state === 'Interesado' || state === 'Cita';
      return {
        agent_id: agent.id,
        address: `${Math.floor(Math.random() * 9999) + 100} W ${rand(['Main', 'Oak', 'Maple', 'Pine', 'Cedar'])} St`,
        city: rand(CITIES),
        lat: 33.0 + Math.random() * 0.8,
        lng: -112.4 + Math.random() * 1.0,
        state,
        timestamp,
        feasibility_checked: hasLead,
        feasibility_passed: hasLead || null,
        approved_sqft: hasLead ? rand([600, 800, 1000]) : null,
        lead_nombre: hasLead ? `Cliente Demo ${i}` : null,
        lead_telefono: hasLead ? `602${String(Math.floor(Math.random() * 9_999_999)).padStart(7, '0')}` : null,
        lead_correo: hasLead ? `cliente${i}@demo.com` : null,
        lead_fecha: hasLead ? timestamp.split('T')[0] : null,
        appointment_datetime: state === 'Cita' ? new Date(now - (daysAgo - 2) * 86_400_000).toISOString() : null,
        appointment_attended: state === 'Cita' ? Math.random() > 0.3 : null,
      };
    });

    // Insert in batches of 100 to avoid payload limits
    for (let i = 0; i < knocks.length; i += 100) {
      const { error } = await supabaseAdmin.from('door_knocks').insert(knocks.slice(i, i + 100));
      if (error) return next(error);
    }

    res.json({ ok: true, message: `Demo reset: ${knocks.length} knocks seeded` });
  } catch (err) { next(err); }
});

module.exports = router;
