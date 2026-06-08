const { supabaseAdmin } = require('../lib/supabase');

async function extractUser(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return { user, token };
}

async function requireAuth(req, res, next) {
  try {
    const result = await extractUser(req);
    if (!result) return res.status(401).json({ error: 'Missing or invalid authorization token' });
    req.user = result.user;
    req.token = result.token;
    next();
  } catch (err) { next(err); }
}

async function requireDirector(req, res, next) {
  try {
    const result = await extractUser(req);
    if (!result) return res.status(401).json({ error: 'Missing or invalid authorization token' });
    req.user = result.user;
    req.token = result.token;

    const { data } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', req.user.id)
      .eq('role', 'director')
      .maybeSingle();

    if (!data) return res.status(403).json({ error: 'Director access required' });
    req.isDirector = true;
    next();
  } catch (err) { next(err); }
}

async function getAgentId(userId) {
  const { data } = await supabaseAdmin
    .from('agents')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.id || null;
}

async function isDirectorUser(userId) {
  const { data } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'director')
    .maybeSingle();
  return !!data;
}

module.exports = { requireAuth, requireDirector, getAgentId, isDirectorUser };
