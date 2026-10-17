import { normalizeLogin } from './login-identity.mjs';
export function normalizeNickname(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}
export function validNickname(value) { return /^[a-z][a-z0-9_]{2,29}$/.test(value); }
export function uniqueNickname(users, name) {
  const base = String(name || 'pessoa').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
  const stem = /^[a-z]/.test(base) && base.length >= 3 ? base : 'pessoa';
  let candidate = stem, suffix = 1;
  while (users.some(user => normalizeNickname(user.nickname) === candidate || normalizeLogin(user.login) === candidate)) candidate = `${stem}_${suffix++}`;
  return candidate;
}
export function canManageTeam(data, user, team) {
  return Boolean(team && user && (user.demoSandboxId || null) === (team.demoSandboxId || null) && team.memberIds?.includes(user.memberId) && (team.captainMemberId === user.memberId || team.adminMemberIds?.includes(user.memberId)));
}
export function invitationStatus(invite, now = Date.now()) {
  return invite.status === 'pending' && Date.parse(invite.expiresAt) <= now ? 'expired' : invite.status;
}
