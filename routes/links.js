const { Router } = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, getAgentId } = require('../middleware/auth');

const router = Router();

// POST /links — agent generates QR/SMS token
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return res.status(403).json({ error: 'Not an agent' });

    const { knockId, channel } = req.body;
    if (!knockId || !channel) return res.status(400).json({ error: 'knockId and channel required' });
    if (!['qr', 'sms'].includes(channel)) return res.status(400).json({ error: 'channel must be qr or sms' });

    const { data: knock } = await supabaseAdmin
      .from('door_knocks')
      .select('agent_id')
      .eq('id', knockId)
      .maybeSingle();
    if (!knock) return res.status(404).json({ error: 'Knock not found' });
    if (knock.agent_id !== agentId) return res.status(403).json({ error: 'Not your knock' });

    const token = crypto.randomBytes(16).toString('hex');

    const { data, error } = await supabaseAdmin
      .from('client_links')
      .insert({ token, knock_id: knockId, agent_id: agentId, channel })
      .select()
      .single();
    if (error) return next(error);

    const base = process.env.FRONTEND_URL || 'http://localhost:5173';
    const url = `${base}/ADU-Pre-Feasibility-Study?token=${token}&agent_id=${agentId}`;

    res.status(201).json({ token: data.token, url });
  } catch (err) { next(err); }
});

// GET /links/:token — public resolve
router.get('/:token', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_links')
      .select('agent_id, knock_id, consumed')
      .eq('token', req.params.token)
      .maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: 'Token not found' });
    res.json({ agentId: data.agent_id, knockId: data.knock_id, consumed: data.consumed });
  } catch (err) { next(err); }
});

module.exports = router;
