const { Router } = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, getAgentId } = require('../middleware/auth');

const router = Router();

// GET /events/latest — agent polls for latest unread match event
router.get('/latest', requireAuth, async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return res.status(403).json({ error: 'Not an agent' });

    const { data, error } = await supabaseAdmin
      .from('match_events')
      .select('*')
      .eq('agent_id', agentId)
      .order('at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return next(error);
    res.json(data || null);
  } catch (err) { next(err); }
});

// DELETE /events/:id — agent dismisses event
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const agentId = await getAgentId(req.user.id);
    if (!agentId) return res.status(403).json({ error: 'Not an agent' });

    const { error } = await supabaseAdmin
      .from('match_events')
      .delete()
      .eq('id', req.params.id)
      .eq('agent_id', agentId);
    if (error) return next(error);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
