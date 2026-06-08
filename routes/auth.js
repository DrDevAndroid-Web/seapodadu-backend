const { Router } = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, getAgentId } = require('../middleware/auth');

const router = Router();

async function buildSession(user, token, refreshToken) {
  const { data: roles } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);
  const role = roles?.[0]?.role || null;

  const agentId = role === 'agente' ? await getAgentId(user.id) : null;

  const { data: agent } = await supabaseAdmin
    .from('agents')
    .select('name')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    access_token: token,
    refresh_token: refreshToken,
    role,
    agentId,
    name: agent?.name || user.email,
    email: user.email
  };
}

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    const session = await buildSession(
      data.user,
      data.session.access_token,
      data.session.refresh_token
    );
    res.json({ session });
  } catch (err) { next(err); }
});

// POST /auth/logout
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await supabaseAdmin.auth.admin.signOut(req.token);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const session = await buildSession(req.user, req.token, null);
    res.json(session);
  } catch (err) { next(err); }
});

module.exports = router;
