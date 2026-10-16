/** One deterministic tree for the configuration, list, chart and SVG export. */
export function projectOrganization(project, members = []) {
  const context = project.context || {}, assignments = context.assignments || [];
  const person = (assignment, role, key) => {
    const member = members.find(m => m.id === assignment.memberId);
    return { id: key || assignment.memberId, kind: 'person', name: member?.displayName || 'Perfil indisponível', role, memberId: assignment.memberId, children: [] };
  };
  const assignedRole = (a, id) => a.sectorRoles?.find(g => g.sectorId === id)?.role || (a.sectorId === id ? a.roleId === 'manager' ? 'manager' : 'member' : null);
  const leaders = assignments.filter(a => a.roleId === 'captain');
  const branches = (context.sectors || []).map(sector => {
    const participants = assignments.filter(a => assignedRole(a, sector.id));
    const managers = participants.filter(a => assignedRole(a, sector.id) === 'manager');
    const people = participants.filter(a => assignedRole(a, sector.id) !== 'manager').map(a => person(a, assignedRole(a, sector.id) === 'viewer' ? 'Participante · leitura' : a.roleId === 'captain' ? 'Responsável pelo projeto' : a.roleId === 'member' ? 'Membro' : context.roles?.find(r => r.id === a.roleId)?.name || 'Membro', `${sector.id}:${a.memberId}`));
    return { id: sector.id, kind: 'sector', name: sector.name, children: [{ id: `${sector.id}:managers`, kind: 'responsibility', name: managers.length ? managers.map(a => members.find(m => m.id === a.memberId)?.displayName || 'Perfil indisponível').join(', ') : 'Gerência não definida', role: 'Gerência de setor', memberIds: managers.map(a => a.memberId), children: people }] };
  });
  const unassigned = assignments.filter(a => a.roleId !== 'captain' && !(context.sectors || []).some(s => assignedRole(a, s.id)));
  if (unassigned.length) branches.push({ id: `${project.id}:unassigned`, kind: 'sector', name: 'Sem setor / apoio', children: unassigned.map(a => person(a, context.roles?.find(r => r.id === a.roleId)?.name || a.roleId)) });
  return { id: project.id, kind: 'project', name: project.name, children: [{ id: `${project.id}:lead`, kind: 'responsibility', name: leaders.length ? leaders.map(a => members.find(m => m.id === a.memberId)?.displayName || 'Perfil indisponível').join(', ') : 'Responsável não definido', role: 'Responsável pelo projeto', memberIds: leaders.map(a => a.memberId), children: branches }] };
}
export function teamOrganization(team, members, projects) {
  const captain = members.find(m => m.id === team.captainMemberId);
  return { id: team.id, kind: 'team', name: team.name, children: [{ id: `${team.id}:captain`, kind: 'responsibility', name: captain?.displayName || 'Capitão não definido', role: 'Capitão da equipe', memberIds: captain ? [captain.id] : [], children: projects.map(p => p.organization || { id: p.id, kind: 'project', name: p.name, children: [] }) }] };
}
