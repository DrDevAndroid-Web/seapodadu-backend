const { Router } = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireDirector } = require('../middleware/auth');

const router = Router();

// GET /reports/summary?from&to&agentId
router.get('/summary', requireDirector, async (req, res, next) => {
  try {
    const { from, to, agentId } = req.query;
    let query = supabaseAdmin
      .from('door_knocks')
      .select('agent_id, state, feasibility_passed, approved_sqft, appointment_attended, agents(name)');

    if (from) query = query.gte('timestamp', from);
    if (to) query = query.lte('timestamp', to);
    if (agentId) query = query.eq('agent_id', agentId);

    const { data, error } = await query;
    if (error) return next(error);

    const byAgent = {};
    for (const row of data) {
      const id = row.agent_id;
      if (!byAgent[id]) {
        byAgent[id] = {
          agentId: id,
          agentName: row.agents?.name || id,
          total: 0, noAtendido: 0, noInteresado: 0, interesado: 0, cita: 0,
          feasibilityStudies: 0, appointmentsTotal: 0, appointmentsAttended: 0,
        };
      }
      const a = byAgent[id];
      a.total++;
      if (row.state === 'No Atendido') a.noAtendido++;
      else if (row.state === 'No Interesado') a.noInteresado++;
      else if (row.state === 'Interesado') a.interesado++;
      else if (row.state === 'Cita') {
        a.cita++;
        a.appointmentsTotal++;
        if (row.appointment_attended) a.appointmentsAttended++;
      }
      if (row.feasibility_passed) a.feasibilityStudies++;
    }

    res.json(Object.values(byAgent));
  } catch (err) { next(err); }
});

// GET /reports/export.csv
router.get('/export.csv', requireDirector, async (req, res, next) => {
  try {
    const { from, to, agentId, state } = req.query;
    let query = supabaseAdmin
      .from('door_knocks')
      .select('*, agents(name)')
      .order('timestamp', { ascending: false });

    if (from) query = query.gte('timestamp', from);
    if (to) query = query.lte('timestamp', to);
    if (agentId) query = query.eq('agent_id', agentId);
    if (state) query = query.eq('state', state);

    const { data, error } = await query;
    if (error) return next(error);

    const esc = v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
    const headers = ['Fecha', 'Agente', 'Dirección', 'Ciudad', 'Estado', 'Cliente', 'Teléfono', 'Correo', 'Notas', 'Sqft Aprobados'];
    const rows = data.map(r => [
      r.timestamp?.split('T')[0], r.agents?.name, r.address, r.city,
      r.state, r.lead_nombre, r.lead_telefono, r.lead_correo, r.notes, r.approved_sqft,
    ].map(esc).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="registros.csv"');
    res.send('﻿' + csv);
  } catch (err) { next(err); }
});

module.exports = router;
