import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "./app.mjs";

function cookieFrom(response) {
  return response.headers["set-cookie"].split(";")[0];
}

test("first registration creates an owner session and protects mutations", async (t) => {
  const storeFile = join(tmpdir(), `mission-dev-${randomUUID()}.json`);
  const app = await buildApp({ storeFile, logger: false });
  t.after(async () => {
    await app.close();
    await rm(storeFile, { force: true });
  });

  const registration = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      name: "Marina Costa",
      email: "marina@example.edu.br",
      password: "uma frase longa para a missao",
      institution: "Universidade de Exemplo",
      course: "Engenharia Aeroespacial",
      academicStage: "5º período",
      primaryArea: "systems",
      skills: ["requisitos"]
    }
  });

  assert.equal(registration.statusCode, 201);
  assert.equal(registration.json().user.accessRole, "owner_admin");
  assert.match(registration.headers["set-cookie"], /HttpOnly/i);
  assert.match(registration.headers["set-cookie"], /SameSite=Strict/i);

  const cookie = cookieFrom(registration);
  const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
  assert.equal(session.json().authenticated, true);

  const rejected = await app.inject({
    method: "POST",
    url: "/api/team/members",
    headers: { cookie },
    payload: {
      displayName: "João Lima",
      email: "joao@example.edu.br",
      missionRole: "member",
      primaryArea: "flight_software",
      institution: "Universidade de Exemplo"
    }
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.json().error, "CSRF_INVALID");

  const accepted = await app.inject({
    method: "POST",
    url: "/api/team/members",
    headers: { cookie, "x-csrf-token": registration.json().csrfToken },
    payload: {
      displayName: "João Lima",
      email: "joao@example.edu.br",
      missionRole: "member",
      primaryArea: "flight_software",
      institution: "Universidade de Exemplo"
    }
  });
  assert.equal(accepted.statusCode, 410);

  const emailOnlyInvitation = await app.inject({
    method: "POST",
    url: "/api/team/members",
    headers: { cookie, "x-csrf-token": registration.json().csrfToken },
    payload: { email: "convite@example.edu.br" }
  });
  assert.equal(emailOnlyInvitation.statusCode, 410);

  const persisted = await readFile(storeFile, "utf8");
  assert.doesNotMatch(persisted, /uma frase longa para a missao/);
  assert.match(persisted, /\$argon2id\$/);
});

test("open registrations receive member access and legacy direct membership routes stay closed", async (t) => {
  const storeFile = join(tmpdir(), `mission-dev-${randomUUID()}.json`);
  const app = await buildApp({ storeFile, logger: false });
  t.after(async () => {
    await app.close();
    await rm(storeFile, { force: true });
  });

  const base = {
    password: "outra frase longa e segura",
    institution: "Universidade de Exemplo",
    primaryArea: "communications_ground"
  };
  const owner = await app.inject({ method: "POST", url: "/api/auth/register", payload: { ...base, name: "Primeira Pessoa", email: "owner@example.edu.br" } });
  const invitation = await app.inject({
    method: "POST",
    url: "/api/team/members",
    headers: { cookie: cookieFrom(owner), "x-csrf-token": owner.json().csrfToken },
    payload: {
      displayName: "Segunda Pessoa",
      email: "member@example.edu.br",
      missionRole: "member",
      primaryArea: "communications_ground",
      institution: "Universidade de Exemplo"
    }
  });
  assert.equal(invitation.statusCode, 410);
  assert.equal("invitationCode" in invitation.json(), false);

  const withoutInvitation = await app.inject({ method: "POST", url: "/api/auth/register", payload: { ...base, name: "Sem Convite", email: "sem-convite@example.edu.br" } });
  assert.equal(withoutInvitation.statusCode, 201);
  assert.equal(withoutInvitation.json().user.accessRole, "member");
  const outsiderCookie = cookieFrom(withoutInvitation);
  const outsiderMembers = await app.inject({ method: "GET", url: "/api/team/members", headers: { cookie: outsiderCookie } });
  assert.deepEqual(outsiderMembers.json().members.map((member) => member.email), ["sem-convite@example.edu.br"]);
  const outsiderArtifacts = await app.inject({ method: "GET", url: "/api/artifacts", headers: { cookie: outsiderCookie } });
  assert.equal(outsiderArtifacts.json().artifacts.length, 0);

  const second = await app.inject({ method: "POST", url: "/api/auth/register", payload: { ...base, name: "Segunda Pessoa", email: "member@example.edu.br" } });
  assert.equal(second.statusCode, 201);
  assert.equal(second.json().user.accessRole, "member");

  const secondCookie = cookieFrom(second);
  const team = await app.inject({ method: "GET", url: "/api/team/members", headers: { cookie: secondCookie } });
  assert.equal(team.statusCode, 200);
  assert.equal(team.json().members.filter((member) => member.email === "member@example.edu.br").length, 1);
  assert.doesNotMatch(JSON.stringify(team.json()), /invitationCodeHash/);

  const memberCannotInvite = await app.inject({
    method: "POST",
    url: "/api/team/members",
    headers: { cookie: secondCookie, "x-csrf-token": second.json().csrfToken },
    payload: {
      displayName: "Terceira Pessoa",
      email: "third@example.edu.br",
      missionRole: "member",
      primaryArea: "flight_software",
      institution: "Universidade de Exemplo"
    }
  });
  assert.equal(memberCannotInvite.statusCode, 410);

  const teamForRoles = (await app.inject({ method: "POST", url: "/api/teams", headers: { cookie: cookieFrom(owner), "x-csrf-token": owner.json().csrfToken }, payload: { name: "Role test team" } })).json().team;
  const roleInvitation = (await app.inject({ method: "POST", url: `/api/teams/${teamForRoles.id}/invitations`, headers: { cookie: cookieFrom(owner), "x-csrf-token": owner.json().csrfToken }, payload: { nickname: second.json().user.nickname } })).json().invitation;
  assert.equal((await app.inject({ method: "POST", url: `/api/invitations/${roleInvitation.id}/respond`, headers: { cookie: secondCookie, "x-csrf-token": second.json().csrfToken }, payload: { decision: "accept" } })).statusCode, 200);
  const projectWithMemberCaptain = {
    schemaVersion: 2,
    id: "project-role-permissions",
    name: "Role permissions",
    context: {
      teamId: teamForRoles.id,
      assignments: [{ memberId: second.json().user.memberId, roleId: "captain", sectorId: "" }]
    },
    board: { nodes: [], links: [] }
  };
  const initialProject = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: cookieFrom(owner), "x-csrf-token": owner.json().csrfToken }, payload: { ...projectWithMemberCaptain, context: { teamId: teamForRoles.id, assignments: [{ memberId: second.json().user.memberId, roleId: "member", sectorId: "" }] } } });
  assert.equal(initialProject.statusCode, 201, initialProject.body);
  Object.assign(projectWithMemberCaptain, initialProject.json().project, { context: { ...initialProject.json().project.context, assignments: projectWithMemberCaptain.context.assignments } });
  const memberCannotPromoteSelf = await app.inject({
    method: "PUT",
    url: "/api/workspace/project",
    headers: { cookie: secondCookie, "x-csrf-token": second.json().csrfToken },
    payload: projectWithMemberCaptain
  });
  assert.equal(memberCannotPromoteSelf.statusCode, 403);

  const savedProject = await app.inject({
    method: "PUT",
    url: "/api/workspace/project",
    headers: { cookie: cookieFrom(owner), "x-csrf-token": owner.json().csrfToken },
    payload: projectWithMemberCaptain
  });
  assert.equal(savedProject.statusCode, 200);

  const projectCaptainCanInvite = await app.inject({
    method: "POST",
    url: "/api/team/members",
    headers: { cookie: secondCookie, "x-csrf-token": second.json().csrfToken },
    payload: { email: "project-invite@example.edu.br" }
  });
  assert.equal(projectCaptainCanInvite.statusCode, 410);

  const unsafeArtifact = await app.inject({
    method: "POST",
    url: "/api/artifacts",
    headers: { cookie: secondCookie, "x-csrf-token": second.json().csrfToken },
    payload: { kind: "link", label: "Unsafe", url: "javascript:alert(1)" }
  });
  assert.equal(unsafeArtifact.statusCode, 400);

  const artifact = await app.inject({
    method: "POST",
    url: "/api/artifacts",
    headers: { cookie: secondCookie, "x-csrf-token": second.json().csrfToken },
    payload: { kind: "repository", label: "Mission firmware", url: "https://github.com/example/mission", tags: ["firmware"] }
  });
  assert.equal(artifact.statusCode, 201);

  const lastOwner = await app.inject({
    method: "PATCH",
    url: `/api/team/members/${owner.json().user.memberId}`,
    headers: { cookie: cookieFrom(owner), "x-csrf-token": owner.json().csrfToken },
    payload: { accessRole: "member" }
  });
  assert.equal(lastOwner.statusCode, 409);
  assert.equal(lastOwner.json().error, "LAST_OWNER");

  const invalidLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "member@example.edu.br", password: "senha incorreta e comprida" } });
  assert.equal(invalidLogin.statusCode, 401);
  assert.equal(invalidLogin.json().error, "INVALID_CREDENTIALS");
});

test("sessions and shared workspaces survive a server restart", async (t) => {
  const storeFile = join(tmpdir(), `norte-${randomUUID()}.json`);
  let app = await buildApp({ storeFile, logger: false, ai: { apiKey: "" } });
  t.after(async () => {
    await app.close().catch(() => undefined);
    await rm(storeFile, { force: true });
  });

  const registration = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      name: "Equipe Norte",
      email: "owner@norte.example",
      password: "uma frase segura para o norte",
      institution: "Universidade de Exemplo",
      primaryArea: "systems"
    }
  });
  const cookie = cookieFrom(registration);
  const csrf = registration.json().csrfToken;
  const project = { schemaVersion: 2, id: "mission-persistence", name: "Persistence project", board: { nodes: [], links: [] } };
  const lab = { schemaVersion: 1, nodes: [], links: [] };

  assert.equal((await app.inject({ method: "PUT", url: "/api/workspace/project", headers: { cookie, "x-csrf-token": csrf }, payload: project })).statusCode, 200);
  assert.equal((await app.inject({ method: "PUT", url: "/api/workspace/labs/mission-persistence", headers: { cookie, "x-csrf-token": csrf }, payload: lab })).statusCode, 200);
  const aiStatus = await app.inject({ method: "GET", url: "/api/brainstorm-ai/status", headers: { cookie } });
  assert.equal(aiStatus.statusCode, 200);
  assert.equal(aiStatus.json().configured, false);

  await app.close();
  app = await buildApp({ storeFile, logger: false, ai: { apiKey: "" } });

  const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
  assert.equal(session.json().authenticated, true);
  const restoredProject = await app.inject({ method: "GET", url: "/api/workspace/project", headers: { cookie } });
  assert.equal(restoredProject.json().project.id, project.id);
  const restoredLab = await app.inject({ method: "GET", url: "/api/workspace/labs/mission-persistence", headers: { cookie } });
  assert.equal(restoredLab.json().board.schemaVersion, 1);
});

test("minimal profiles, teams, artifacts, and multiple projects share one workspace", async (t) => {
  const storeFile = join(tmpdir(), `norte-workspace-${randomUUID()}.json`);
  const app = await buildApp({ storeFile, logger: false });
  t.after(async () => {
    await app.close();
    await rm(storeFile, { force: true });
  });

  const registration = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      name: "Emily Teste",
      email: "emily.teste@example.edu.br",
      password: "uma frase segura para testar"
    }
  });
  assert.equal(registration.statusCode, 201);
  assert.equal(registration.json().user.profileComplete, false);
  const headers = {
    cookie: cookieFrom(registration),
    "x-csrf-token": registration.json().csrfToken
  };

  const profile = await app.inject({ method: "GET", url: "/api/profile", headers });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().profile.institution, "");

  const updatedProfile = await app.inject({
    method: "PATCH",
    url: "/api/profile",
    headers,
    payload: {
      institution: "Universidade de Exemplo",
      course: "Engenharia Aeroespacial",
      academicStage: "4º semestre",
      availabilityHours: 12
    }
  });
  assert.equal(updatedProfile.statusCode, 200);
  assert.equal(updatedProfile.json().user.profileComplete, true);

  const teamResponse = await app.inject({
    method: "POST",
    url: "/api/teams",
    headers,
    payload: { name: "Equipe Horizonte", description: "Equipe universitária de validação." }
  });
  assert.equal(teamResponse.statusCode, 201);
  const teamId = teamResponse.json().team.id;

  const artifactResponse = await app.inject({
    method: "POST",
    url: "/api/artifacts",
    headers,
    payload: {
      kind: "document",
      label: "Relatório anterior",
      url: "https://example.edu.br/relatorio.pdf",
      description: "Memória permanente da equipe.",
      sourceRole: "supporting_datasheet",
      scope: "team",
      ownerId: teamId
    }
  });
  assert.equal(artifactResponse.statusCode, 201);
  const artifactId = artifactResponse.json().artifact.id;
  assert.equal(artifactResponse.json().artifact.sourceRole, 'supporting_datasheet');
  const roleChanged = await app.inject({ method: 'PATCH', url: '/api/artifacts/' + artifactId, headers, payload: { sourceRole: 'project_context', expectedRevision: 0 } });
  assert.equal(roleChanged.statusCode, 200, roleChanged.body);
  assert.equal(roleChanged.json().artifact.sourceRole, 'project_context');
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/artifacts/' + artifactId, headers, payload: { sourceRole: 'trusted_instructions' } })).statusCode, 400);

  const invitedAccount = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Pessoa Convidada", email: "convidada@example.edu.br", password: "a sufficiently long test passphrase" } });
  assert.equal(invitedAccount.statusCode, 201);
  const invitedMemberId = invitedAccount.json().user.memberId;
  const invitation = await app.inject({ method: "POST", url: `/api/teams/${teamId}/invitations`, headers, payload: { nickname: invitedAccount.json().user.nickname } });
  assert.equal(invitation.statusCode, 201, invitation.body);
  const accepted = await app.inject({ method: "POST", url: `/api/invitations/${invitation.json().invitation.id}/respond`, headers: { cookie: cookieFrom(invitedAccount), "x-csrf-token": invitedAccount.json().csrfToken }, payload: { decision: "accept" } });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const detachedMember = await app.inject({
    method: "DELETE",
    url: `/api/teams/${teamId}/members/${invitedMemberId}`,
    headers
  });
  assert.equal(detachedMember.statusCode, 204);
  const profilesAfterDetach = await app.inject({ method: "GET", url: "/api/team/members", headers });
  assert.equal(profilesAfterDetach.json().members.some((member) => member.id === invitedMemberId), false, 'removing a member also revokes directory visibility');
  assert.equal((await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie: cookieFrom(invitedAccount) } })).statusCode, 200, 'the detached account remains intact');

  const project = {
    schemaVersion: 2,
    id: "workspace-project",
    name: "Projeto Horizonte",
    context: {
      configured: true,
      programId: "obsat",
      modalityId: "practical",
      categoryId: "n3",
      teamId,
      teamName: "Equipe Horizonte",
      teamArtifactIds: [artifactId],
      projectArtifactIds: [],
      roles: [{ id: "captain", name: "Capitão" }],
      sectors: [],
      assignments: [{ memberId: registration.json().user.memberId, roleId: "captain", sectorId: "" }]
    },
    board: { nodes: [], links: [] }
  };
  const createdProject = await app.inject({ method: "POST", url: "/api/projects", headers, payload: project });
  assert.equal(createdProject.statusCode, 201);

  const projects = await app.inject({ method: "GET", url: "/api/projects", headers });
  assert.equal(projects.statusCode, 200);
  assert.equal(projects.json().projects.some((item) => item.id === project.id && item.memberCount === 1), true);

  const teams = await app.inject({ method: "GET", url: "/api/teams", headers });
  const createdTeam = teams.json().teams.find((item) => item.id === teamId);
  assert.equal(createdTeam.membership, "member");
  assert.equal(createdTeam.artifactIds.includes(artifactId), true);
});

test("public directories hide private team data and project lifecycle controls deletion", async (t) => {
  const storeFile = join(tmpdir(), `norte-directory-${randomUUID()}.json`);
  const app = await buildApp({ storeFile, logger: false });
  t.after(async () => {
    await app.close();
    await rm(storeFile, { force: true });
  });

  const owner = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { name: "Capitã Norte", email: "capita@norte.example", password: "uma frase segura para a capita" }
  });
  const ownerHeaders = { cookie: cookieFrom(owner), "x-csrf-token": owner.json().csrfToken };
  const teamResponse = await app.inject({ method: "POST", url: "/api/teams", headers: ownerHeaders, payload: { name: "Equipe Privada", description: "Descrição pública da equipe." } });
  const teamId = teamResponse.json().team.id;

  const fileContents = Buffer.from("decisao,responsavel\nTeste,Equipe\n");
  const fileArtifact = await app.inject({
    method: "POST",
    url: "/api/artifacts",
    headers: ownerHeaders,
    payload: {
      kind: "dataset",
      label: "Decisões da equipe",
      url: `data:text/csv;base64,${fileContents.toString("base64")}`,
      fileName: "decisoes.csv",
      mimeType: "text/csv",
      size: fileContents.length,
      scope: "team",
      ownerId: teamId
    }
  });
  assert.equal(fileArtifact.statusCode, 201);
  assert.equal(fileArtifact.json().artifact.fileName, "decisoes.csv");

  const unsafeFile = await app.inject({
    method: "POST",
    url: "/api/artifacts",
    headers: ownerHeaders,
    payload: {
      kind: "document",
      label: "Página insegura",
      url: `data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`,
      fileName: "pagina.html",
      mimeType: "text/html",
      size: 25,
      scope: "team",
      ownerId: teamId
    }
  });
  assert.equal(unsafeFile.statusCode, 400);

  const outsider = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { name: "Pessoa Externa", email: "externa@norte.example", password: "outra frase segura para entrar" }
  });
  const outsiderCookie = cookieFrom(outsider);
  const publicTeams = await app.inject({ method: "GET", url: "/api/teams", headers: { cookie: outsiderCookie } });
  const publicTeam = publicTeams.json().teams.find((team) => team.id === teamId);
  assert.equal(publicTeam.memberCount, 1);
  assert.deepEqual(publicTeam.memberIds, []);
  assert.deepEqual(publicTeam.artifactIds, []);
  assert.deepEqual(publicTeam.joinRequests, []);
  assert.equal(publicTeam.createdBy, null);

  const directory = await app.inject({ method: "GET", url: "/api/directory/members", headers: { cookie: outsiderCookie } });
  assert.equal(directory.statusCode, 200);
  assert.equal(directory.json().members.length, 1);
  assert.equal(Object.hasOwn(directory.json().members[0], "email"), false);

  const project = {
    schemaVersion: 2,
    id: "project-team-lifecycle",
    name: "Projeto de ciclo de vida",
    context: { teamId, assignments: [{ memberId: owner.json().user.memberId, roleId: "captain", sectorId: "" }], projectArtifactIds: [], teamArtifactIds: [] },
    board: { nodes: [], links: [] }
  };
  assert.equal((await app.inject({ method: "POST", url: "/api/projects", headers: ownerHeaders, payload: project })).statusCode, 201);
  const teamProjects = await app.inject({ method: "GET", url: `/api/teams/${teamId}/projects`, headers: ownerHeaders });
  assert.equal(teamProjects.statusCode, 200);
  assert.equal(teamProjects.json().projects[0].id, project.id);
  assert.equal(teamProjects.json().projects[0].participants[0].displayName, "Capitã Norte");
  const privateProjects = await app.inject({ method: "GET", url: `/api/teams/${teamId}/projects`, headers: { cookie: outsiderCookie } });
  assert.equal(privateProjects.statusCode, 200);
  assert.deepEqual(privateProjects.json().projects, []);
  const teamsWithCount = await app.inject({ method: "GET", url: "/api/teams", headers: { cookie: outsiderCookie } });
  assert.equal(teamsWithCount.json().teams.find((team) => team.id === teamId).projectCount, 1);
  const teamInUse = await app.inject({ method: "DELETE", url: `/api/teams/${teamId}`, headers: ownerHeaders });
  assert.equal(teamInUse.statusCode, 409);
  assert.equal(teamInUse.json().error, "TEAM_IN_USE");
  assert.equal((await app.inject({ method: "DELETE", url: `/api/projects/${project.id}`, headers: ownerHeaders })).statusCode, 204);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/teams/${teamId}`, headers: ownerHeaders })).statusCode, 409);
  assert.ok(app.missionStore.read().artifacts.some(a => a.id === fileArtifact.json().artifact.id), "hidden team files are preserved");
  assert.equal((await app.inject({ method: "DELETE", url: `/api/artifacts/${fileArtifact.json().artifact.id}`, headers: ownerHeaders })).statusCode, 204);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/teams/${teamId}`, headers: ownerHeaders })).statusCode, 204);
  const artifactsAfterDelete = await app.inject({ method: "GET", url: "/api/artifacts", headers: { cookie: cookieFrom(owner) } });
  assert.equal(artifactsAfterDelete.json().artifacts.some((artifact) => artifact.id === fileArtifact.json().artifact.id), false);
});
