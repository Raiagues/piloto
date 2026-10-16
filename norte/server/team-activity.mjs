import { createHmac, randomBytes } from 'node:crypto';
import { canManageTeam, invitationStatus } from './team-identity.mjs';
const DAY = 86400_000;
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode, code: 'FORBIDDEN' });
export const ACTIVITY_NOTICE = 'Registramos o último acesso e, por projeto, dias ativos, sessões de acesso (intervalo mínimo de 30 minutos), contagens de artefatos criados/editados e alterações de organização. Os resumos dos últimos 30 dias ficam disponíveis aos responsáveis autorizados. Não registramos cliques, movimentos, documentos lidos nem horas de produtividade. Visitas ao perfil da equipe são agregadas, sem divulgar a identidade dos visitantes.';
export function pruneCollaborationData(data, now = Date.now()) {
  const cutoff = new Date(now - 29 * DAY).toISOString().slice(0, 10);
  data.activity = (data.activity || []).filter(row => row.date >= cutoff);
  for (const stats of Object.values(data.teamStats || {})) stats.days = stats.days.filter(day => day.date >= cutoff);
  data.emailVerifications = (data.emailVerifications || []).filter(v => Date.parse(v.expiresAt) > now);
  for (const invite of data.invitations || []) {
    if (invitationStatus(invite, now) === 'expired') { invite.status = 'expired'; delete invite.tokenHash; }
  }
}
export function recordActivity(data, userId, projectId, kind, now = Date.now()) {
  if (!data.workspace.projects?.[projectId]) return;
  const date = new Date(now).toISOString().slice(0, 10);
  data.activity = (data.activity || []).filter(row => row.date >= new Date(now - 30 * DAY).toISOString().slice(0, 10));
  let row = data.activity.find(r => r.userId === userId && r.projectId === projectId && r.date === date);
  if (!row) { row = { userId, projectId, date, accesses: 0, artifactCreated: 0, artifactEdited: 0, organizationUpdated: 0 }; data.activity.push(row); }
  if (kind === 'access') {
    if (!row.lastAccessAt || now - Date.parse(row.lastAccessAt) >= 30 * 60_000) { row.accesses++; row.lastAccessAt = new Date(now).toISOString(); }
  } else row[kind] = (row[kind] || 0) + 1;
  row.lastActivityAt = new Date(now).toISOString();
}
export function registerTeamActivity(app, { store, requireAuth, requireCsrf, canAccessProject }) {
  const write = [requireAuth, requireCsrf];
  let maintenanceDay = '', maintenance;
  app.addHook('onRequest', async request => {
    if (!request.url.startsWith('/api/')) return;
    const today = new Date().toISOString().slice(0, 10);
    if (today === maintenanceDay) return;
    maintenance ||= store.update(data => { pruneCollaborationData(data); }).then(() => { maintenanceDay = today; }).finally(() => { maintenance = null; });
    await maintenance;
  });
  app.get('/api/activity-notice', { preHandler: [requireAuth] }, async () => ({ notice: ACTIVITY_NOTICE, retentionDays: 30 }));
  app.post('/api/projects/:id/visit', { preHandler: write, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async request => {
    await store.update(data => {
      const record = data.workspace.projects?.[request.params.id];
      if (!record || !canAccessProject(data, request.auth.user, record)) throw fail(403, 'Projeto indisponível.');
      recordActivity(data, request.auth.user.id, request.params.id, 'access');
    });
    return { ok: true };
  });
  app.post('/api/teams/:id/visit', { preHandler: write, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async request => {
    await store.update(data => {
      const team = data.teams.find(t => t.id === request.params.id);
      if (!team) throw fail(404, 'Equipe não encontrada.');
      if (team.memberIds.includes(request.auth.user.memberId) || canManageTeam(data, request.auth.user, team)) return;
      const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
      const stats = data.teamStats[team.id] ||= { secret: randomBytes(32).toString('hex'), totalVisits: 0, days: [] };
      // Team-specific pseudonyms expire after 30 days. No IP, email or account ID.
      stats.days = stats.days.filter(d => d.date >= new Date(now - 29 * DAY).toISOString().slice(0, 10));
      let day = stats.days.find(d => d.date === today);
      if (!day) { day = { date: today, visits: 0, visitors: {} }; stats.days.push(day); }
      const visitor = createHmac('sha256', stats.secret).update(request.auth.user.id).digest('hex');
      if (day.visitors[visitor] && now - day.visitors[visitor] < 30 * 60_000) return;
      day.visitors[visitor] = now; day.visits++; stats.totalVisits++;
    });
    return { ok: true };
  });
  app.get('/api/teams/:id/insights', { preHandler: [requireAuth] }, async request => {
    const data = store.read(), team = data.teams.find(t => t.id === request.params.id);
    if (!canManageTeam(data, request.auth.user, team)) throw fail(403, 'Estatísticas restritas à administração desta equipe.');
    const cutoff = new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10);
    const stats = data.teamStats[team.id], days = (stats?.days || []).filter(d => d.date >= cutoff);
    const projectIds = new Set(Object.values(data.workspace.projects).filter(r => r.document.context?.teamId === team.id).map(r => r.document.id));
    const activity = data.activity.filter(r => projectIds.has(r.projectId) && r.date >= cutoff);
    return {
      notice: ACTIVITY_NOTICE, periodDays: 30,
      visits: { total: stats?.totalVisits || 0, unique: new Set(days.flatMap(d => Object.keys(d.visitors))).size, days: Array.from({ length: 30 }, (_, n) => {
        const date = new Date(Date.now() - (29 - n) * DAY).toISOString().slice(0, 10), day = days.find(d => d.date === date);
        return { date, visits: day?.visits || 0, unique: Object.keys(day?.visitors || {}).length };
      }) },
      members: team.memberIds.map(memberId => {
        const member = data.members.find(m => m.id === memberId), user = data.users.find(u => u.memberId === memberId);
        const rows = activity.filter(r => r.userId === user?.id);
        const sum = key => rows.reduce((n, r) => n + (r[key] || 0), 0);
        return { memberId, name: member?.displayName || 'Membro', lastSeenAt: user?.lastSeenAt || null, lastProjectActivity: rows.map(r => r.lastActivityAt).sort().at(-1) || null, activeDays: new Set(rows.map(r => r.date)).size, accesses: sum('accesses'), artifactCreated: sum('artifactCreated'), artifactEdited: sum('artifactEdited'), recent: rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map(r => ({ date: r.date, projectName: data.workspace.projects[r.projectId]?.document.name, artifactCreated: r.artifactCreated, artifactEdited: r.artifactEdited, organizationUpdated: r.organizationUpdated })) };
      })
    };
  });
}
