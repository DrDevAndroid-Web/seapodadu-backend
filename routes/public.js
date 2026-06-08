const { Router } = require('express');
const { supabaseAdmin } = require('../lib/supabase');

const router = Router();

function calcApprovedSqft(address) {
  const options = [600, 800, 1000];
  return options[address.length % options.length];
}

// POST /public/consumer-submit — no auth, uses service_role internally
router.post('/consumer-submit', async (req, res, next) => {
  try {
    const { token, agentId: bodyAgentId, address, city, name, phone, email } = req.body;
    if (!address || !name || !phone || !email) {
      return res.status(400).json({ error: 'address, name, phone and email are required' });
    }

    let knockId = null;
    let resolvedAgentId = bodyAgentId || null;
    let approvedSqft = calcApprovedSqft(address);
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    // 1. Match via token
    if (token) {
      const { data: link } = await supabaseAdmin
        .from('client_links')
        .select('knock_id, agent_id, consumed')
        .eq('token', token)
        .maybeSingle();

      if (link && !link.consumed) {
        knockId = link.knock_id;
        resolvedAgentId = link.agent_id;
        await supabaseAdmin
          .from('client_links')
          .update({ consumed: true })
          .eq('token', token);
      }
    }

    // 2. Match by phone or email in existing knocks
    if (!knockId) {
      const { data: matched } = await supabaseAdmin
        .from('door_knocks')
        .select('id, agent_id, approved_sqft')
        .or(`lead_telefono.eq.${phone},lead_correo.eq.${email}`)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (matched) {
        knockId = matched.id;
        resolvedAgentId = resolvedAgentId || matched.agent_id;
        approvedSqft = matched.approved_sqft || approvedSqft;
      }
    }

    // 3. Match by address (fuzzy via ilike)
    if (!knockId && resolvedAgentId) {
      const { data: addrMatch } = await supabaseAdmin
        .from('door_knocks')
        .select('id, agent_id')
        .eq('agent_id', resolvedAgentId)
        .ilike('address', `%${address.split(' ').slice(0, 3).join(' ')}%`)
        .limit(1)
        .maybeSingle();

      if (addrMatch) knockId = addrMatch.id;
    }

    const leadData = {
      state: 'Interesado',
      feasibility_checked: true,
      feasibility_passed: true,
      approved_sqft: approvedSqft,
      lead_fecha: today,
      lead_nombre: name,
      lead_telefono: phone,
      lead_correo: email,
      lead_direccion: address,
      updated_at: now,
    };

    if (knockId) {
      await supabaseAdmin.from('door_knocks').update(leadData).eq('id', knockId);
    } else if (resolvedAgentId) {
      const { data: newKnock } = await supabaseAdmin
        .from('door_knocks')
        .insert({
          agent_id: resolvedAgentId,
          address,
          city: city || 'Phoenix',
          lat: 33.4484,
          lng: -112.0740,
          timestamp: now,
          ...leadData,
        })
        .select('id')
        .single();
      knockId = newKnock?.id;
    }

    // Emit match event
    if (knockId && resolvedAgentId) {
      await supabaseAdmin.from('match_events').insert({
        agent_id: resolvedAgentId,
        knock_id: knockId,
        sqft: approvedSqft,
        client_name: name,
      });
    }

    res.json({ ok: true, approvedSqft, knockId });
  } catch (err) { next(err); }
});

// POST /public/geocode — Nominatim proxy
router.post('/geocode', async (req, res, next) => {
  try {
    const { q } = req.body;
    if (!q) return res.status(400).json({ error: 'q is required' });

    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=us&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SeaPodADU/1.0 contact@seapodadu.com' }
    });
    if (!response.ok) return res.status(502).json({ error: 'Geocoding service unavailable' });
    const data = await response.json();
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
