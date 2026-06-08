const { Router } = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, getAgentId, isDirectorUser } = require('../middleware/auth');

const router = Router();

function buildInsert(body) {
  return {
    address: body.address,
    gps_address: body.gpsAddress || null,
    city: body.city,
    lat: body.lat,
    lng: body.lng,
    state: body.state || 'No Atendido',
    timestamp: body.timestamp || new Date().toISOString(),
    feasibility_checked: body.feasibilityChecked || false,
    feasibility_passed: body.feasibilityPassed ?? null,
    approved_sqft: body.approvedSqft ?? null,
    lead_fecha: body.lead?.fecha ?? null,
    lead_direccion: body.lead?.direccion ?? null,
    lead_nombre: body.lead?.nombre ?? null,
    lead_telefono: body.lead?.telefono ?? null,
    lead_correo: body.lead?.correo ?? null,
    appointment_datetime: body.appointment?.datetime ?? null,
    appointment_attended: body.appointment?.attended ?? null,
    notes: body.notes ?? null,
  };
}

function buildPatch(body) {
  const dbMap = {
    address: 'address', gpsAddress: 'gps_address', city: 'city',
    lat: 'lat', lng: 'lng', state: 'state',
    feasibilityChecked: 'feasibility_checked', feasibilityPassed: 'feasibility_passed',
    approvedSqft: 'approved_sqft', notes: 'notes',
  };
  const patch = {};
  for (const [jsKey, dbKey] of Object.entries(dbMap)) {
    if (body[jsKey] !== undefined) patch[dbKey] = body[jsKey];
  }
  if (body.lead !== undefined) {
    patch.lead_fecha = body.lead?.fecha ?? null;
    patch.lead_direccion = body.lead?.direccion ?? null;
    patch.lead_nombre = body.lead?.nombre ?? null;
    patch.lead_telefono = body.lead?.telefono ?? null;
    patch.lead_correo = body.lead?.correo ?? null;
  }
  if (body.appointment !== undefined) {
    patch.appointment_datetime = body.appointment?.datetime ?? null;
    patch.appointment_attended = body.appointment?.attended ?? null;
  }
  patch.updated_at = new Date().toISOString();
  return patch;
}

function formatKnock(row) {
  if (!row) return null;
  const k = {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agents?.name,
    address: row.address,
    gpsAddress: row.gps_address,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    state: row.state,
    timestamp: row.timestamp,
    updatedAt: row.updated_at,
    feasibilityChecked: row.feasibility_checked,
    feasibilityPassed: row.feasibility_passed,
    approvedSqft: row.approved_sqft,
    notes: row.notes,
  };
  if (row.lead_nombre) {
    k.lead = {
      fecha: row.lead_fecha,
      direccion: row.lead_direccion,
      nombre: row.lead_nombre,
      telefono: row.lead_telefono,
      correo: row.lead_correo,
    };
  }
  if (row.appointment_datetime) {
    k.appointment = {
      datetime: row.appointment_datetime,
      attended: row.appointment_attended,
    };
  }
  return k;
}

// GET /knocks — director, with filters
router.get('/', async (req, res, next) => {
  try {
    // Inline director check to reuse query builder
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization token' });
    const token = auth.slice(7);
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });
    const dir = await isDirectorUser(user.id);
    if (!dir) return res.status(403).json({ error: 'Director access required' });

    const { agentId, state, from, to, q, city } = req.query;
    let query = supabaseAdmin
      .from('door_knocks')
      .select('*, agents(name)')
      .order('timestamp', { ascending: false })
      .limit(500);

    if (agentId) query = query.eq('agent_id', agentId);
    if (state) query = query.eq('state', state);
    if (city) query = query.eq('city', city);
    if (from) query = query.gte('timestamp', from);
    if (to) query = query.lte('timestamp', to);
    if (q) query = query.or(`address.ilike.%${q}%,lead_nombre.ilike.%${q}%,city.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) return next(error);
    res.json(data.map(formatKnock));
  } catch (err) { next(err); }
});

// GET /knocks/mine — agent's own records
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return res.status(403).json({ error: 'Not an agent' });

    const { from, to } = req.query;
    let query = supabaseAdmin
      .from('door_knocks')
      .select('*')
      .eq('agent_id', agentId)
      .order('timestamp', { ascending: false });

    if (from) query = query.gte('timestamp', from);
    if (to) query = query.lte('timestamp', to);

    const { data, error } = await query;
    if (error) return next(error);
    res.json(data.map(formatKnock));
  } catch (err) { next(err); }
});

// GET /knocks/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('door_knocks')
      .select('*, agents(name)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: 'Knock not found' });
    res.json(formatKnock(data));
  } catch (err) { next(err); }
});

// POST /knocks — agent creates
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return res.status(403).json({ error: 'Not an agent' });

    const { address, city, lat, lng } = req.body;
    if (!address || !city || lat == null || lng == null) {
      return res.status(400).json({ error: 'address, city, lat and lng are required' });
    }

    const insert = { ...buildInsert(req.body), agent_id: agentId };

    const { data, error } = await supabaseAdmin
      .from('door_knocks')
      .insert(insert)
      .select()
      .single();
    if (error) return next(error);
    res.status(201).json(formatKnock(data));
  } catch (err) { next(err); }
});

// PATCH /knocks/:id — agent or director partial update
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    const dir = await isDirectorUser(req.user.id);

    const { data: existing } = await supabaseAdmin
      .from('door_knocks')
      .select('agent_id')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Knock not found' });
    if (!dir && existing.agent_id !== agentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const patch = buildPatch(req.body);
    const { data, error } = await supabaseAdmin
      .from('door_knocks')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return next(error);
    res.json(formatKnock(data));
  } catch (err) { next(err); }
});

module.exports = router;
