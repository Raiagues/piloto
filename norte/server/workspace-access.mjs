import { isFictionalProfile } from './reviewer-eligibility.mjs';

export const isRealAccount = user => Boolean(user && user.active !== false && !user.disabled && !isFictionalProfile(user));
export function professionalMembership(team, memberId) {
  const entry = Object.hasOwn(team.professionalProfiles || {}, memberId) ? team.professionalProfiles[memberId] : null;
  return { teamId: team.id, teamName: team.name, memberId,
    roleName: entry?.roleName || (team.captainMemberId === memberId ? 'Gestor da equipe' : 'Integrante'),
    functionName: entry?.functionName || '', version: entry?.version || 0,
    updatedAt: entry?.updatedAt || null, updatedBy: entry?.updatedBy || null };
}
