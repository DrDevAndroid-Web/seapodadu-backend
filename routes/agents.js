const { Router } = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, requireDirector } = require('../middleware/auth');

const router = Router();

async function generateAgentId() {
  const now = new Date();
  const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { data } = await supabaseAdmin
    .from('agents')
    .select('id')
    .like('id', `${prefix}%`)
    .order('id', { ascending: false })
    .limit(1);
  const seq = data?.[0]?.id ? parseInt(data[0].id.slice(6)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// GET /agents — director only, all agents
router.get('/', requireDirector, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return next(error);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /agents/active — authenticated, for selects
router.get('/active', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('agents')
      .select('id, name, email, phone')
      .eq('active', true)
      .order('name');
    if (error) return next(error);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /agents — director creates agent + auth user
router.post('/', requireDirector, async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'name, email and phone are required' });
    }

    const agentId = await generateAgentId();
    const pwd = password || crypto.randomBytes(6).toString('hex') + 'A1!';

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: pwd,
      email_confirm: true
    });
    if (authError) return res.status(400).json({ error: authError.message });

    const userId = authData.user.id;

    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .insert({ id: agentId, user_id: userId, name, email, phone })
      .select()
      .single();

    if (agentError) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      return next(agentError);
    }

    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({ user_id: userId, role: 'agente' });

    if (roleError) {
      // Roll back: remove agent record and auth user so state stays consistent
      await supabaseAdmin.from('agents').delete().eq('id', agentId).catch(() => {});
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      return next(roleError);
    }

    res.status(201).json({ agent, tempPassword: password ? undefined : pwd });
  } catch (err) { next(err); }
});

// PATCH /agents/:id/deactivate
router.patch('/:id/deactivate', requireDirector, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('agents')
      .update({ active: false })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: 'Agent not found' });
    res.json(data);
  } catch (err) { next(err); }
});

// PATCH /agents/:id/reactivate
router.patch('/:id/reactivate', requireDirector, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('agents')
      .update({ active: true })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: 'Agent not found' });
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /agents/:id — permanent
router.delete('/:id', requireDirector, async (req, res, next) => {
  try {
    const { data: agent } = await supabaseAdmin
      .from('agents')
      .select('user_id')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const { error } = await supabaseAdmin
      .from('agents')
      .delete()
      .eq('id', req.params.id);
    if (error) return next(error);

    if (agent.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(agent.user_id).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
