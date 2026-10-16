import { registerMemoryCollaborationRoutes } from './memory-collaboration.mjs';
import { normalizeNickname, validNickname, uniqueNickname, canManageTeam } from "./team-identity.mjs";
import { registerInvitations } from "./team-invitations.mjs";
import { registerOnboarding } from "./onboarding.mjs";
import { registerConfigurationChanges } from "./configuration-changes.mjs";
import { registerIdeaStarterRoutes } from "./idea-starters.mjs";
import { registerIdeaSessions } from "./idea-sessions.mjs";
import { preparePublicQuetzalDemo } from "./quetzal-public-demo.mjs";
import { registerPlatformRoutes } from "./platform-service.mjs";
import { registerDeliveryRoutes } from "./project-delivery.mjs";
import { registerTeamActivity, recordActivity } from "./team-activity.mjs";
import { registerMeetings } from "./meeting-service.mjs";
import { registerMeetingGateway } from "./meeting-gateway.mjs";
import { createProjectIntelligence, registerIntelligenceRoutes } from "./project-intelligence.mjs";
import { geminiConfig } from "./gemini-config.mjs";
import { captureValidationResponse } from './validation-capture.mjs';
import { projectOrganization } from "../shared/organization-tree.mjs";
import { requireArtifactEditor, requireProjectAdmin, validateProjectOrganization } from "./project-organization.mjs";
import { renderArtifactPdf } from "./artifact-pdf.mjs";
import { interpretationRequestSchema } from "./discovery-interpretation.mjs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import argon2 from "argon2";
import { JsonDataStore } from "./data-store.mjs";
import { PostgresDataStore } from "./postgres-store.mjs";
import { brainstormRequestSchema, createBrainstormAiService } from "./brainstorm-ai.mjs";
import { createSystemAiService, generationRequestSchema, projectArtifacts, validateEngineeringSystem } from "./system-ai.mjs";
import { artifactReadabilityRecord } from "./artifact-content.mjs";
import { createDemoSandbox, demoAccountEnabled, demoExpiresAt, DEMO_TTL_MS, pruneDemoSandboxes, sameDemoScope } from "./demo-account.mjs";
import { VALIDATION_DOCUMENTS_MISSING_MESSAGE } from "./validation-documents.mjs";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 15;
const ACCESS_ROLES = ["owner_admin", "captain", "manager", "member", "advisor"];
const MEMBER_STATUSES = ["demo", "invited", "active"];
const ARTIFACT_KINDS = ["official", "document", "repository", "dataset", "link"];
const MAX_ARTIFACT_FILE_BYTES = 48 * 1024 * 1024;
const MAX_ARTIFACT_BODY_BYTES = 66 * 1024 * 1024;
const SAFE_ARTIFACT_MIME_TYPES = new Set([
  "application/octet-stream",
  "image/png",
  "image/jpeg",
  "application/json",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/markdown",
  "text/plain"
]);
const COMMON_PASSWORDS = new Set([
  "123456789012345",
  "passwordpassword",
  "senha1234567890",
  "missiondev12345",
  "qwertyuiop12345"
]);

const string = (maxLength, minLength = 0) => ({ type: "string", minLength, maxLength });
const stringList = (maxItems = 12, maxLength = 80) => ({ type: "array", maxItems, items: string(maxLength, 1), uniqueItems: true });

const profileProperties = {
  displayName: string(100, 2),
  email: string(254, 3),
  missionRole: string(60),
  primaryArea: string(80),
  secondaryAreas: stringList(6, 80),
  institution: string(160),
  course: string(120),
  academicStage: string(80),
  skills: stringList(16, 60),
  availabilityHours: { type: "integer", minimum: 0, maximum: 80 },
  notes: string(800),
  avatarUrl: string(300_000),
  accountStatus: { type: "string", enum: MEMBER_STATUSES }
};

const registerBody = {
  type: "object",
  additionalProperties: false,
  required: ["name", "email", "password"],
  properties: {
    name: string(100, 2),
    nickname: string(30, 3),
    email: string(254, 3),
    password: string(128, PASSWORD_MIN_LENGTH),
    bootstrapToken: string(512),
    institution: string(160, 2),
    course: string(120),
    academicStage: string(80),
    primaryArea: string(80),
    skills: stringList(16, 60),
    availabilityHours: { type: "integer", minimum: 0, maximum: 80 }
  }
};

const memberPatchBody = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: { ...profileProperties, accessRole: { type: "string", enum: ACCESS_ROLES } }
};

const ownProfileBody = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    nickname: string(30, 3),
    displayName: string(100, 2),
    institution: string(160),
    course: string(120),
    academicStage: string(80),
    availabilityHours: { type: "integer", minimum: 0, maximum: 80 },
    avatarUrl: string(300_000)
  }
};

const artifactProperties = {
  folderId: { anyOf: [string(100, 1), { type: "null" }] },
  entityId: { anyOf: [string(100, 1), { type: "null" }] },
  documentText: string(5_000_000),
  kind: { type: "string", enum: ARTIFACT_KINDS },
  label: string(140, 2),
  url: string(MAX_ARTIFACT_BODY_BYTES, 1),
  description: string(500),
  sourceRole: { enum: ['project_context', 'supporting_datasheet'] },
  tags: stringList(12, 50),
  scope: { type: "string", enum: ["team", "project"] },
  ownerId: { anyOf: [string(100, 1), { type: "null" }] },
  fileName: string(255),
  mimeType: string(120),
  size: { type: "integer", minimum: 0, maximum: MAX_ARTIFACT_FILE_BYTES }
};

const teamBody = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: string(100, 2), description: string(300) }
};

const artifactBody = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "label"],
  properties: artifactProperties
};

const artifactPatchBody = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: { ...artifactProperties, expectedRevision: { type: "integer", minimum: 0 } }
};

function normalizeEmail(email) {
  return email.trim().toLocaleLowerCase("en-US");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value;
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeText(item)).filter(Boolean))];
}

function normalizePassword(value) {
  return value.normalize("NFKC");
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
}

function validatePassword(password) {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) return false;
  return !COMMON_PASSWORDS.has(password.toLocaleLowerCase("en-US"));
}

function validateArtifactUrl(value) {
  const dataMatch = /^data:([^;,]+);base64,([a-zA-Z0-9+/=]+)$/u.exec(value);
  if (dataMatch) {
    if (!SAFE_ARTIFACT_MIME_TYPES.has(dataMatch[1])) return false;
    const padding = dataMatch[2].endsWith("==") ? 2 : dataMatch[2].endsWith("=") ? 1 : 0;
    const decodedSize = Math.floor(dataMatch[2].length * 3 / 4) - padding;
    return decodedSize > 0 && decodedSize <= MAX_ARTIFACT_FILE_BYTES;
  }
  if (/^artifacts\/[a-zA-Z0-9_./-]+$/u.test(value) && !value.includes("..")) return true;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateAvatarUrl(value) {
  if (!value) return true;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/u.test(value)) return value.length <= 300_000;
  if (/^\/[a-zA-Z0-9_./-]+$/u.test(value) && !value.includes("..")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeTextEqual(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

function initials(name) {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function publicUser(user, environment) {
  return {
    id: user.id,
    testEnvironment: environment === "team-preview-test",
    memberId: user.memberId,
    nickname: user.nickname,
    emailVerifiedAt: user.emailVerifiedAt || null,
    name: user.name,
    initials: initials(user.name),
    email: user.email,
    accessRole: user.accessRole,
    institution: user.institution,
    primaryArea: user.primaryArea,
    avatarUrl: user.avatarUrl || "",
    profileComplete: Boolean(user.institution && user.course && user.academicStage),
    demoAccount: Boolean(user.isDemoAccount)
  };
}

function publicMember(data, member) {
  const safe = { ...member };
  delete safe.invitationCodeHash;
  delete safe.invitationExpiresAt;
  const account = member.accountId ? data.users.find((item) => item.id === member.accountId) : null;
  safe.accessRole = account?.accessRole || null;
  safe.nickname = account?.nickname || null;
  return safe;
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}


function cleanArtifactInput(body) {
  if (body.documentText !== undefined && (body.kind !== "document" || typeof body.documentText !== "string" || !body.documentText.trim())) throw httpError(400, "INVALID_DOCUMENT", "Escreva o conteúdo do documento.");
  if (body.documentText !== undefined) {
    const bytes = Buffer.from(body.documentText, "utf8");
    body = { ...body, url: `data:text/markdown;base64,${bytes.toString("base64")}`, mimeType: "text/markdown", fileName: `${body.label}.md`, size: bytes.length };
  }
  const url = normalizeText(body.url || "");
  if (!validateArtifactUrl(url)) throw httpError(400, "INVALID_URL", "Use an HTTP(S) address or a supported file up to 48 MiB.");
  if (!body.label?.trim() || body.label.trim().length < 2) throw httpError(400, "INVALID_LABEL", "Informe um nome com pelo menos dois caracteres.");
  const isFile = url.startsWith("data:");
  const fileName = [...normalizeText(body.fileName || "")].filter((character) => character.charCodeAt(0) >= 32 && !["/", "\\"].includes(character)).join("").slice(0, 255);
  const mimeType = normalizeText(body.mimeType || "").toLocaleLowerCase("en-US");
  const size = Number.isInteger(body.size) ? body.size : 0;
  if (isFile && (!fileName || !SAFE_ARTIFACT_MIME_TYPES.has(mimeType) || size <= 0 || size > MAX_ARTIFACT_FILE_BYTES || !url.startsWith(`data:${mimeType};base64,`))) {
    throw httpError(400, "INVALID_FILE", "The uploaded file metadata is invalid or unsupported.");
  }
  if (isFile) {
    const base64 = url.slice(url.indexOf(',') + 1), bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64 || bytes.length !== size) throw httpError(400, "INVALID_FILE", "Os metadados não correspondem ao arquivo enviado.");
  }
  if (body.scope === "team" && (body.folderId || body.entityId)) throw httpError(400, "INVALID_FOLDER", "Pastas técnicas pertencem ao projeto.");
  return {
    folderId: body.folderId || null,
    entityId: body.entityId || null,
    ...(body.documentText !== undefined ? { documentText: body.documentText } : {}),
    kind: body.kind,
    label: normalizeText(body.label),
    url,
    description: normalizeText(body.description || ""),
    sourceRole: (body.sourceRole || body.provenance?.role) === 'supporting_datasheet' ? 'supporting_datasheet' : 'project_context',
    tags: normalizeList(body.tags),
    scope: body.scope === "team" ? "team" : "project",
    ownerId: normalizeText(body.ownerId || null),
    fileName: isFile ? fileName : "",
    mimeType: isFile ? mimeType : "",
    size: isFile ? size : 0
  };
}

// Stored file bytes are large; the list only carries a pointer to them plus the
// server's own readability verdict, so pages never download the whole library.
const INLINE_ARTIFACT_URL_LIMIT = 8 * 1024;

function publicArtifact(artifact) {
  const stored = typeof artifact.url === "string" ? artifact.url : "";
  const next = { ...artifact, sourceRole: artifact.sourceRole || artifact.provenance?.role || 'project_context', readability: artifactReadabilityRecord(artifact) };
  if (!stored.startsWith("data:")) return next;
  next.contentPath = `/artifacts/${artifact.id}/content`;
  if (stored.length > INLINE_ARTIFACT_URL_LIMIT) next.url = "";
  return next;
}

function validProjectDocument(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.schemaVersion === 2
    && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 100
    && value.board && typeof value.board === "object"
    && Array.isArray(value.board.nodes) && Array.isArray(value.board.links)
    && (value.engineeringSystem === undefined || validateEngineeringSystem(value.engineeringSystem))
    && (value.memoryRevision === undefined || (Number.isInteger(value.memoryRevision) && value.memoryRevision >= 0))
    && (value.systemGeneratedFromRevision === undefined || (Number.isInteger(value.systemGeneratedFromRevision) && value.systemGeneratedFromRevision >= 0))
    && (value.phaseProgress === undefined || (value.phaseProgress && [0, 1, 2].includes(value.phaseProgress.highestUnlockedStep)));
}

function preserveProjectProgress(previous, next) {
  if (!previous || previous.id !== next.id) return next;
  // A tab opened before a background regeneration must never restore the old
  // generation through an unrelated autosave. Edits within the current map
  // remain valid; replacements use the reviewed extraction apply endpoint.
  const generation = model => [model.id, model.generatedAt, model.generatedFromRevision ?? 0];
  if (previous.engineeringSystem && next.engineeringSystem && !isDeepStrictEqual(generation(previous.engineeringSystem), generation(next.engineeringSystem))) {
    throw httpError(409, "SYSTEM_BASELINE_CHANGED", "O mapa foi atualizado durante a edição. Reabra o projeto antes de salvar para preservar a versão atual.");
  }
  if (previous.sourcePackages?.some((id) => !next.sourcePackages?.includes(id))) {
    throw httpError(409, "PROJECT_UPDATED", "New project sources were added. Reload before saving to keep the updated architecture.");
  }
  const memory = (project) => ({ projectType: project.projectType, sectors: project.context?.sectors, folders: project.context?.folders, teamArtifactFolders: project.context?.teamArtifactFolders, name: project.name, setup: project.setup, teamId: project.context?.teamId, teamArtifactIds: project.context?.teamArtifactIds, projectArtifactIds: project.context?.projectArtifactIds, programId: project.context?.programId, modalityId: project.context?.modalityId, categoryId: project.context?.categoryId });
  const changed = !isDeepStrictEqual(memory(previous), memory(next));
  return { ...next,
    memoryRevision: Math.max(next.memoryRevision || 0, (previous.memoryRevision || 0) + (changed ? 1 : 0)),
    phaseProgress: { highestUnlockedStep: Math.max(previous.phaseProgress?.highestUnlockedStep || 0, next.phaseProgress?.highestUnlockedStep || 0) },
    ...(previous.engineeringSystem && !next.engineeringSystem ? { engineeringSystem: previous.engineeringSystem, systemGeneratedFromRevision: previous.systemGeneratedFromRevision } : {})
  };
}

function markArtifactMemoryChanged(data, artifactId) {
  for (const record of Object.values(data.workspace.projects || {})) {
    const project = record?.document;
    if (![...(project?.context?.teamArtifactIds || []), ...(project?.context?.projectArtifactIds || [])].includes(artifactId)) continue;
    project.memoryRevision = (project.memoryRevision || 0) + 1;
    project.updatedAt = new Date().toISOString();
    record.updatedAt = project.updatedAt;
    record.revision = (record.revision || 0) + 1;
    if (data.workspace.project?.document?.id === project.id) data.workspace.project = record;
  }
}

function projectMemorySnapshot(project, artifacts) {
  return { name: project.name, revision: project.memoryRevision || 0, context: project.context, setup: project.setup, artifacts: projectArtifacts(project, artifacts) };
}

function validLabBoard(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.schemaVersion === 1
    && Array.isArray(value.nodes) && Array.isArray(value.links)
    && value.nodes.length <= 500 && value.links.length <= 1_000;
}

export async function buildApp(options = {}) {
  const production = process.env.NODE_ENV === "production";
  const bootstrapToken = String(options.bootstrapToken ?? process.env.NORTE_BOOTSTRAP_TOKEN ?? "").trim();
  const bootstrapDigest = createHash("sha256").update(bootstrapToken).digest();
  // An inactive/removed initial administrator must never reopen public setup.
  // Store only completion metadata; the deployment secret is never persisted.
  const administrationInitialized = data => Boolean(data.authBootstrap?.completedAt)
    || data.users.some(user => user.accessRole === "owner_admin" && !user.isDemoAccount);
  function requireInitialBootstrap(data, submittedToken) {
    if (!production) return;
    const supplied = typeof submittedToken === "string" ? submittedToken.trim() : "";
    if (administrationInitialized(data)) {
      if (supplied) throw httpError(409, "BOOTSTRAP_COMPLETE", "A configuração inicial já foi concluída. Atualize a página e crie sua conta sem o código inicial.");
      return;
    }
    if (bootstrapToken.length < 32 || bootstrapToken.length > 512) throw httpError(503, "BOOTSTRAP_UNAVAILABLE", "Initial account setup is not configured.");
    const suppliedDigest = createHash("sha256").update(supplied).digest();
    if (!timingSafeEqual(bootstrapDigest, suppliedDigest)) throw httpError(403, "BOOTSTRAP_INVALID", "Informe um código de configuração inicial válido, fornecido pelo responsável pela instalação.");
  }
  const cookieName = options.cookieName || (production ? "__Host-norte_session" : "norte_session");
  const demoAccount = options.demoAccount ?? demoAccountEnabled(process.env, production);
  const demoCookieName = production ? "__Host-norte_demo" : "norte_demo";
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (process.env.RENDER && !databaseUrl && !options.store && !options.storeFile) throw new Error("DATABASE_URL is required on Render so user documents are not stored on ephemeral disk.");
  const store = options.store || await (options.storeFile || !databaseUrl
    ? new JsonDataStore(options.storeFile || resolve("var/mission-dev-data.json"))
    : new PostgresDataStore(databaseUrl)).init();

  const systemAiOptions = options.systemAi || options.ai || {};
  const intelligence = options.intelligence || createProjectIntelligence({ store, ...(options.jev ? { jev: options.jev } : {}), canAccessProject, inferencePolicy: geminiConfig(systemAiOptions, 'discovery'),
    canReadArtifact: (data, user, artifact) => visibleArtifacts(data, user).some(item => item.id === artifact.id) });
  const initializingSystems = new Map();
  const extractionJobs = new Map(Object.entries(store.read().workspace.extractionJobs || {}));
  const extractionStarts = new Map();
  const logger = options.logger ?? {
    level: process.env.LOG_LEVEL || "info",
    redact: ["req.headers.cookie", "req.headers.authorization", "password", "body.password", "body.token", "req.body.token", "req.body.password", "bootstrapToken", "body.bootstrapToken", "req.body.bootstrapToken"]
  };
  const app = Fastify({ logger, bodyLimit: 512 * 1024, trustProxy: production });
  // Register before any awaited plugin: static serving can finalize route
  // contexts, which must inherit this sanitized API error handler.
  app.setErrorHandler((error, request, reply) => {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    const validation = error.validation ? "The submitted data is incomplete or invalid." : null;
    const provisioning = statusCode === 503 && error.code === "VALIDATION_DOCUMENTS_MISSING" ? VALIDATION_DOCUMENTS_MISSING_MESSAGE : null;
    reply.code(statusCode).send({
      error: error.validation ? "VALIDATION_ERROR" : error.code || "INTERNAL_ERROR",
      message: validation || provisioning || (statusCode < 500 ? error.message : "The server could not complete this request.")
    });
  });
  const ai = createBrainstormAiService({ ...options.ai, onAttempt: async (record, payload) => {
    app.log.info({ event: "engineering.provider_attempt", ...record }, "Organization provider attempt completed");
    await options.ai?.onAttempt?.(record, payload);
  } });
  const systemAi = options.systemAiService || createSystemAiService({ ...systemAiOptions,
    feedbackContext: systemAiOptions.feedbackContext || intelligence.feedbackContext,
    fastInterpreter: (...args) => intelligence.fastInterpreter(...args),
    rememberInterpretation: (...args) => intelligence.rememberInterpretation(...args),
    onRejection: async (record) => {
    app.log.warn({ event: "discovery.interpretation_rejected", ...record }, "Discovery interpretation rejected");
    await systemAiOptions.onRejection?.(record);
  }, onAttempt: async (record, payload) => {
    app.log.info({ event: "engineering.provider_attempt", ...record }, "Engineering provider attempt completed");
    await intelligence.recordProviderAttempt?.(record);
    await captureValidationResponse(record, payload);
    await systemAiOptions.onAttempt?.(record, payload);
  } });

  await app.register(cookie);
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: { directives: { mediaSrc: ["'self'", "blob:", ...(() => { try { const tutorial = new URL(process.env.NORTE_CHAT_TUTORIAL_URL || ''); return tutorial.protocol === 'https:' ? [tutorial.origin] : []; } catch { return []; } })()] } },
    crossOriginResourcePolicy: { policy: "same-site" }
  });
  await app.register(rateLimit, { global: false, ipv6Subnet: 64 });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Norte API",
        version: "1.0.0",
        description: "Contas, equipe e memória de projetos de missões universitárias."
      },
      components: {
        securitySchemes: {
          sessionCookie: { type: "apiKey", in: "cookie", name: cookieName },
          csrfToken: { type: "apiKey", in: "header", name: "x-csrf-token" }
        }
      },
      tags: [
        { name: "System", description: "Saúde e disponibilidade" },
        { name: "Authentication", description: "Cadastro e sessão" },
        { name: "Team", description: "Perfis e responsabilidades" },
        { name: "Artifacts", description: "Fontes conectadas à missão" }
      ]
    }
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
    staticCSP: true,
    transformStaticCSP: (header) => header
  });

  async function setSession(reply, userId) {
    const token = randomBytes(32).toString("base64url");
    const session = {
      id: randomUUID(),
      userId,
      tokenHash: hashToken(token),
      csrfToken: randomBytes(24).toString("base64url"),
      lastSeenAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    await store.update((data) => {
      data.sessions = data.sessions.filter((item) => item.expiresAt > Date.now());
      data.sessions.push(session);
      const user = data.users.find(u => u.id === userId);
      if (user) user.lastSeenAt = session.lastSeenAt;
      return null;
    });
    reply.setCookie(cookieName, token, {
      path: "/",
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      maxAge: Math.floor(SESSION_TTL_MS / 1000)
    });
    return session;
  }

  async function clearSession(request, reply) {
    const token = request.cookies[cookieName];
    if (token) {
      const tokenHash = hashToken(token);
      await store.update((data) => {
        data.sessions = data.sessions.filter((item) => item.tokenHash !== tokenHash && item.expiresAt > Date.now());
        return null;
      });
    }
    reply.clearCookie(cookieName, { path: "/", secure: production, sameSite: "strict" });
  }

  function getSessionUser(request) {
    const token = request.cookies[cookieName];
    if (!token) return null;
    const data = store.read();
    const session = data.sessions.find((item) => item.tokenHash === hashToken(token) && item.expiresAt > Date.now());
    if (!session) return null;
    const user = data.users.find((item) => item.id === session.userId && item.active);
    if (!user) return null;
    return { session, user };
  }

  function demoRecoveryHash(request) {
    const token = request.cookies[demoCookieName];
    return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/u.test(token) ? hashToken(token) : null;
  }

  function resumableDemo(data, request) {
    const tokenHash = demoRecoveryHash(request);
    return tokenHash ? data.users.find(user => user.active && user.isDemoAccount && user.demoSandboxOwner
      && user.demoResumeTokenHash === tokenHash && demoExpiresAt(user) > Date.now()) : undefined;
  }

  // Only an authenticated owner or its existing random browser credential can
  // establish recovery. A client-supplied account/project id is never accepted.
  function retainDemo(data, request, userId) {
    const user = data.users.find(item => item.id === userId && item.active && item.isDemoAccount && item.demoSandboxOwner);
    if (!user) return null;
    const current = request.cookies[demoCookieName];
    const tokenHash = demoRecoveryHash(request);
    const token = tokenHash && tokenHash === user.demoResumeTokenHash ? current : randomBytes(32).toString("base64url");
    user.demoResumeTokenHash = hashToken(token);
    user.demoExpiresAt = Date.now() + DEMO_TTL_MS;
    return token;
  }

  function setDemoCookie(reply, token) {
    if (token) reply.setCookie(demoCookieName, token, { path: "/", httpOnly: true, secure: production,
      sameSite: "strict", maxAge: Math.floor(DEMO_TTL_MS / 1000) });
  }

  async function requireAuth(request) {
    const auth = getSessionUser(request);
    if (!auth) throw httpError(401, "AUTH_REQUIRED", "Authentication is required.");
    request.auth = auth;
    if (auth.user.isDemoAccount) {
      // A sandbox never reaches real teams, and it cannot send mail on the operator's behalf.
      const teamId = request.url.match(/^\/api\/teams\/([^/?]+)/u)?.[1];
      if (teamId && !teamId.startsWith(`${auth.user.demoSandboxId}-`)) throw httpError(404, "TEAM_NOT_FOUND", "Team was not found.");
      if (request.method !== "GET" && /^\/api\/(teams\/[^/]+\/invitations|auth\/email-verification|admin)(?:\/|$)/u.test(request.url)) throw httpError(403, "DEMO_RESTRICTED", "Esta ação não está disponível na conta de demonstração.");
    }
    if (auth.user.pendingLegacyMemberId && !auth.user.emailVerifiedAt && !/^\/api\/(auth(?:\/|$)|invitations(?:\/|$)|profile$)/.test(request.url)) throw httpError(403, "EMAIL_NOT_VERIFIED", "Verifique seu email em Convites para recuperar seu perfil existente.");
  }

  async function requireCsrf(request) {
    if (!request.auth) await requireAuth(request);
    const received = request.headers["x-csrf-token"];
    if (typeof received !== "string" || !constantTimeTextEqual(received, request.auth.session.csrfToken)) {
      throw httpError(403, "CSRF_INVALID", "The request verification token is missing or invalid.");
    }
  }

  function requireRole(user, allowed) {
    if (!allowed.includes(user.accessRole)) throw httpError(403, "FORBIDDEN", "Your project role cannot perform this action.");
  }

  function requireTeamRole(user, allowedAccessRoles, allowedProjectRoles) {
    if (allowedAccessRoles.includes(user.accessRole)) return;
    const data = store.read();
    const records = Object.values(data.workspace.projects || {});
    const allowed = records.some((record) => record?.document?.context?.assignments?.some((item) => item.memberId === user.memberId && allowedProjectRoles.includes(item.roleId)));
    if (!allowed) {
      throw httpError(403, "FORBIDDEN", "Your project role cannot perform this action.");
    }
  }

  function canManageNamedTeam(data, user, team) { return canManageTeam(data, user, team); }

  function requireNamedTeamManager(data, user, team) {
    if (!team || !canManageNamedTeam(data, user, team)) throw httpError(403, "FORBIDDEN", "You cannot manage this team.");
  }

  function requireMemberManager(data, user, memberId) {
    const manages = data.teams.some(team => team.memberIds.includes(memberId) && canManageNamedTeam(data, user, team));
    if (!manages) throw httpError(403, "FORBIDDEN", "Você não pode administrar este perfil.");
  }

  function canAccessProject(data, user, record) {
    if (!user || !record) return false;
    if (!sameDemoScope(user, record)) return false;
    const teamId = record?.document?.context?.teamId;
    if (teamId) return Boolean(data.teams.find(t => t.id === teamId)?.memberIds.includes(user.memberId));
    return record?.createdBy === user.id || Boolean(record?.document?.context?.assignments?.some(a => a.memberId === user.memberId));
  }

  /** One visibility rule for both the artifact list and its file downloads. */
  function visibleArtifacts(data, user) {
    const teamIds = new Set(data.teams.filter((team) => team.memberIds.includes(user.memberId)).map((team) => team.id));
    const projectIds = new Set(Object.entries(data.workspace.projects || {}).filter(([, record]) => canAccessProject(data, user, record)).map(([projectId]) => projectId));
    return data.artifacts.filter((artifact) => sameDemoScope(user, artifact) && (artifact.official
      || (!artifact.ownerId && artifact.createdBy === user.id)
      || (artifact.scope === "team" && teamIds.has(artifact.ownerId))
      || (artifact.scope === "project" && projectIds.has(artifact.ownerId))));
  }

  function artifactForUser(data, user, artifact) {
    let canEdit = false;
    try {
      if (artifact.official) canEdit = artifact.createdBy === user.id;
      else if (artifact.scope === "team") canEdit = canManageNamedTeam(data, user, data.teams.find(t => t.id === artifact.ownerId));
      else { requireArtifactEditor(data, user, artifact); canEdit = true; }
    } catch { /* visibility does not confer edit permission */ }
    return { ...publicArtifact(artifact), revision: artifact.revision || 0, canEdit, editReason: canEdit ? "Você pode editar este artefato." : "Somente leitura. A edição é restrita aos participantes autorizados do setor e aos responsáveis pelo projeto." };
  }
  function presence(data, user) {
    const online = user.active && data.sessions.some(session => session.userId === user.id && session.expiresAt > Date.now() && Date.now() - Date.parse(session.lastSeenAt || "") < 90_000);
    return { presence: online ? "online" : "offline", lastSeenAt: user.lastSeenAt || user.lastLoginAt || null };
  }
  registerMemoryCollaborationRoutes(app, { store, requireAuth, requireCsrf, visibleArtifacts, canAccessProject });
  registerInvitations(app, { store, requireAuth, requireCsrf, mailer: options.mailer });
  registerTeamActivity(app, { store, requireAuth, requireCsrf, canAccessProject });
  registerIntelligenceRoutes(app, { store, requireAuth, requireCsrf, canAccessProject, intelligence });
  registerDeliveryRoutes(app, { store, requireAuth, requireCsrf, canAccessProject, analysisOptions: systemAiOptions, intelligence });
  registerOnboarding(app, { store, requireAuth, requireCsrf });
  registerConfigurationChanges(app, { store, requireAuth, requireCsrf, canAccessProject, intelligence });
  registerIdeaStarterRoutes(app, { store, requireAuth, requireCsrf, canAccessProject, intelligence, aiOptions: systemAiOptions });
  registerIdeaSessions(app, { store, requireAuth, requireCsrf, canAccessProject, intelligence, systemAi });
  registerPlatformRoutes(app, { store, requireAuth, requireCsrf, canAccessProject, presence, getSessionUser, production, ...options.platform });
  const meetingAccess = registerMeetings(app, { store, requireAuth, requireCsrf, canAccessProject, retrieveContext: options.meetingContext || (input => intelligence.meetingContext(input)) });
  registerMeetingGateway(app, { store, requireAuth, requireCsrf, access: meetingAccess, ...options.meetingGateway, prepareMeetingRequest: options.prepareMeetingRequest || (input => intelligence.prepareMeetingRequest(input)) });
  app.decorate('projectIntelligence', intelligence);
  app.post("/api/auth/heartbeat", { preHandler: [requireAuth, requireCsrf] }, async (request, reply) => {
    const recoveryToken = await store.update(data => {
      const session = data.sessions.find(s => s.id === request.auth.session.id && s.expiresAt > Date.now());
      if (!session) throw httpError(401, "AUTH_REQUIRED", "Session expired.");
      const timestamp = new Date().toISOString();
      session.lastSeenAt = timestamp;
      data.users.find(u => u.id === session.userId).lastSeenAt = timestamp;
      return retainDemo(data, request, session.userId);
    });
    setDemoCookie(reply, recoveryToken);
    return { ok: true };
  });
  app.get("/api/admin/users", { preHandler: [requireAuth] }, async (request) => {
    requireRole(request.auth.user, ["owner_admin"]);
    const data = store.read();
    return { users: data.users.filter(user => user.id === request.auth.user.id || data.teams.some(team => team.memberIds.includes(user.memberId) && canManageNamedTeam(data, request.auth.user, team))).map(user => ({ ...publicUser(user, data.environment), active: user.active, ...presence(data, user) })) };
  });
  app.get("/api/projects/:id/activity", { preHandler: [requireAuth] }, async (request) => {
    const data = store.read(), record = data.workspace.projects?.[request.params.id];
    if (!record) throw httpError(404, "PROJECT_NOT_FOUND", "Project not found.");
    if (!canAccessProject(data, request.auth.user, record)) throw httpError(403, "FORBIDDEN", "Project access denied.");
    requireProjectAdmin(record, request.auth.user);
    return { users: (record.document.context?.assignments || []).map(a => {
      const member = data.members.find(m => m.id === a.memberId), user = data.users.find(u => u.memberId === a.memberId);
      return { id: a.memberId, name: member?.displayName || "", ...(user ? presence(data, user) : { presence: "offline", lastSeenAt: null }) };
    }) };
  });

  function projectSummary(record) {
    const project = record.document;
    return {
      id: project.id,
      name: project.name || "Projeto sem título",
      projectType: project.projectType ?? null,
      programId: project.context?.programId ?? null,
      teamId: project.context?.teamId ?? null,
      updatedAt: record.updatedAt || project.updatedAt,
      memberCount: Array.isArray(project.context?.assignments) ? project.context.assignments.length : 0
    };
  }

  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/")) await store.refresh?.();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return;
    const allowedOrigins = new Set((process.env.NORTE_ALLOWED_ORIGINS || process.env.MISSION_ALLOWED_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173").split(",").map((item) => item.trim()));
    const forwardedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
    const sameHost = (() => {
      try {
        return new URL(origin).host === forwardedHost;
      } catch {
        return false;
      }
    })();
    if (!sameHost && !allowedOrigins.has(origin)) throw httpError(403, "ORIGIN_REJECTED", "Request origin is not allowed.");
  });

  app.get("/api/health", {
    schema: { tags: ["System"], summary: "Check API health" }
  }, async () => {
    await store.health?.();
    // `engineering` reports only whether a key is present, never the key itself,
    // so a deployment can be verified with one unauthenticated request.
    const engineering = systemAi.status();
    return { status: "ok", version: "1.0.0", revision: /^[a-f0-9]{40}$/.test(process.env.RENDER_GIT_COMMIT || "") ? process.env.RENDER_GIT_COMMIT : null, pid: process.pid, supervisorPid: process.ppid, storage: databaseUrl ? "postgresql" : "local", engineering: { configured: engineering.configured, model: engineering.model } };
  });

  app.get("/api/auth/session", {
    schema: { tags: ["Authentication"], summary: "Read the current session" }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const auth = getSessionUser(request);
    const currentData = store.read();
    const hasOwner = currentData.users.some((user) => user.accessRole === "owner_admin" && user.active);
    const bootstrapRequired = production && !administrationInitialized(currentData);
    if (auth?.user.isDemoAccount) {
      const recoveryToken = await store.update(data => retainDemo(data, request, auth.user.id));
      setDemoCookie(reply, recoveryToken);
    }
    const demoResumeAvailable = demoAccount && Boolean(resumableDemo(store.read(), request) || auth?.user.demoSandboxOwner);
    if (!auth) return { authenticated: false, hasOwner, bootstrapRequired, demoAvailable: demoAccount, demoResumeAvailable };
    return { authenticated: true, hasOwner, bootstrapRequired, demoAvailable: demoAccount, demoResumeAvailable, user: publicUser(auth.user, store.read().environment), csrfToken: auth.session.csrfToken };
  });

  app.post("/api/auth/demo", {
    config: { rateLimit: { max: 12, timeWindow: "15 minutes" } },
    schema: { tags: ["Authentication"], summary: "Open or resume this browser's isolated test workspace" }
  }, async (request, reply) => {
    if (!demoAccount) throw httpError(404, "DEMO_UNAVAILABLE", "A conta de demonstração não está habilitada neste ambiente.");
    const auth = getSessionUser(request);
    if (auth && !auth.user.isDemoAccount) throw httpError(409, "ACCOUNT_ALREADY_OPEN", "Saia da sua conta antes de abrir a conta de teste.");
    if (auth) await requireCsrf(request);
    const result = await store.update((data) => {
      const current = auth && data.sessions.some(session => session.id === auth.session.id && session.expiresAt > Date.now())
        ? data.users.find(user => user.id === auth.user.id && user.active && user.demoSandboxOwner) : null;
      if (auth && !current) throw httpError(401, "AUTH_REQUIRED", "Session expired.");
      let user = current || resumableDemo(data, request);
      const resumed = Boolean(user);
      // Adopt a valid legacy session before expiry cleanup, preserving its map.
      if (user) user.demoExpiresAt = Date.now() + DEMO_TTL_MS;
      pruneDemoSandboxes(data);
      if (!user) {
        user = createDemoSandbox(data);
        const projectId = `${user.demoSandboxId}-quetzal-1`;
        if (data.workspace.projects[projectId]) {
          preparePublicQuetzalDemo(data, { projectId, actorId: user.id });
          user = data.users.find(candidate => candidate.id === user.id);
        }
      }
      const token = retainDemo(data, request, user.id);
      user.lastLoginAt = new Date().toISOString();
      return { user, token, resumed };
    });
    const session = await setSession(reply, result.user.id);
    setDemoCookie(reply, result.token);
    reply.code(result.resumed ? 200 : 201);
    return { user: publicUser(result.user, store.read().environment), csrfToken: session.csrfToken, resumed: result.resumed, demoResumeAvailable: true };
  });

  app.post("/api/auth/register", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    schema: { tags: ["Authentication"], summary: "Create an account", body: registerBody }
  }, async (request, reply) => {
    const body = request.body;
    requireInitialBootstrap(store.read(), body.bootstrapToken);
    const email = normalizeEmail(body.email);
    const password = normalizePassword(body.password);
    if (!validateEmail(email)) throw httpError(400, "INVALID_EMAIL", "Enter a valid email address.");
    if (!validatePassword(password)) throw httpError(400, "WEAK_PASSWORD", `Use a passphrase with at least ${PASSWORD_MIN_LENGTH} characters.`);
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1
    });

    const user = await store.update((data) => {
      // Repeat under the store transaction/lock: concurrent requests cannot
      // both become the first owner or reuse a just-consumed setup token.
      requireInitialBootstrap(data, body.bootstrapToken);
      const nickname = body.nickname ? normalizeNickname(body.nickname) : uniqueNickname(data.users, body.name);
      if (!validNickname(nickname)) throw httpError(400, "INVALID_NICKNAME", "Use 3 a 30 letras, números ou sublinhado, começando por uma letra.");
      if (data.users.some(u => u.nickname === nickname)) throw httpError(409, "NICKNAME_EXISTS", "Este nickname já está em uso.");
      if (data.users.some((item) => item.email === email)) throw httpError(409, "EMAIL_EXISTS", "An account already uses this email.");
      const timestamp = new Date().toISOString();
      const isFirstAccount = production ? !administrationInitialized(data)
        : !data.users.some((item) => item.accessRole === "owner_admin" && item.active);
      if (isFirstAccount || administrationInitialized(data)) data.authBootstrap ??= { completedAt: timestamp };
      const invitedMember = data.members.find((item) => item.email === email && !item.accountId);
      const memberId = invitedMember?.id || randomUUID();
      const nextUser = {
        id: randomUUID(),
        memberId,
        name: normalizeText(body.name),
        nickname, emailVerifiedAt: null,
        email,
        passwordHash,
        accessRole: isFirstAccount ? "owner_admin" : invitedMember?.missionRole === "advisor" ? "advisor" : "member",
        institution: normalizeText(body.institution || ""),
        course: normalizeText(body.course || ""),
        academicStage: normalizeText(body.academicStage || ""),
        availabilityHours: Number.isInteger(body.availabilityHours) ? body.availabilityHours : 0,
        avatarUrl: normalizeText(body.avatarUrl || ""),
        primaryArea: invitedMember?.primaryArea || body.primaryArea || "systems",
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: timestamp
      };
      data.users.push(nextUser);
      if (invitedMember) {
        // Reserve the existing identity without exposing or changing its profile.
        // Mailbox verification attaches the account; team entry still needs acceptance.
        nextUser.pendingLegacyMemberId = invitedMember.id;
      } else {
        data.members.push({
          id: memberId,
          accountId: nextUser.id,
          displayName: nextUser.name,
          email,
          missionRole: "captain",
          primaryArea: body.primaryArea || "systems",
          secondaryAreas: [],
          institution: nextUser.institution,
          course: normalizeText(body.course || ""),
          academicStage: normalizeText(body.academicStage || ""),
          skills: normalizeList(body.skills),
          availabilityHours: Number.isInteger(body.availabilityHours) ? body.availabilityHours : 0,
          notes: "",
          avatarUrl: normalizeText(body.avatarUrl || ""),
          accountStatus: "active",
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }
      if (isFirstAccount && data.teams[0]) {
        data.teams[0].memberIds = [...new Set([...data.teams[0].memberIds, memberId])];
        data.teams[0].createdBy ||= nextUser.id;
        data.teams[0].captainMemberId ||= memberId;
        data.teams[0].updatedAt = timestamp;
        for (const record of Object.values(data.workspace.projects || {})) {
          if (record.document.context?.teamId !== data.teams[0].id || record.createdBy) continue;
          record.createdBy = nextUser.id;
          record.document.creatorId = nextUser.id;
        }
      }
      return nextUser;
    });
    const session = await setSession(reply, user.id);
    reply.code(201);
    return { user: publicUser(user, store.read().environment), csrfToken: session.csrfToken };
  });

  app.post("/api/auth/login", {
    config: { rateLimit: { max: 8, timeWindow: "15 minutes" } },
    schema: {
      tags: ["Authentication"],
      summary: "Start a secure session",
      body: {
        type: "object",
        additionalProperties: false,
        required: ["email", "password"],
        properties: { email: string(254, 3), password: string(128, 1) }
      }
    }
  }, async (request, reply) => {
    const email = normalizeEmail(request.body.email);
    const password = normalizePassword(request.body.password);
    const user = store.read().users.find((item) => item.email === email && item.active);
    const valid = user && !user.isDemoAccount ? await argon2.verify(user.passwordHash, password).catch(() => false) : false;
    if (!valid) throw httpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    await store.update((data) => {
      const storedUser = data.users.find((item) => item.id === user.id);
      if (storedUser) {
        storedUser.lastLoginAt = new Date().toISOString();
        storedUser.updatedAt = storedUser.lastLoginAt;
      }
      return null;
    });
    const session = await setSession(reply, user.id);
    return { user: publicUser(user, store.read().environment), csrfToken: session.csrfToken };
  });

  app.post("/api/auth/logout", {
    preHandler: [requireAuth, requireCsrf],
    schema: { tags: ["Authentication"], summary: "End the current session", security: [{ sessionCookie: [], csrfToken: [] }] }
  }, async (request, reply) => {
    // Logout ends authentication; explicitly choosing Resume is required again.
    if (request.auth.user.isDemoAccount) {
      const token = await store.update(data => retainDemo(data, request, request.auth.user.id));
      setDemoCookie(reply, token);
    }
    await clearSession(request, reply);
    reply.code(204).send();
  });

  app.get("/api/profile", {
    preHandler: [requireAuth],
    schema: { tags: ["Authentication"], summary: "Read the current academic profile", security: [{ sessionCookie: [] }] }
  }, async (request) => {
    const data = store.read();
    const member = data.members.find((item) => item.id === request.auth.user.memberId);
    if (!member) throw httpError(404, "PROFILE_NOT_FOUND", "Your profile was not found.");
    if (request.auth.user.pendingLegacyMemberId && !request.auth.user.emailVerifiedAt) throw httpError(403, "EMAIL_NOT_VERIFIED", "Verifique seu email antes de recuperar o perfil.");
    return { profile: publicMember(data, member) };
  });

  app.patch("/api/profile", {
    preHandler: [requireAuth, requireCsrf],
    schema: { tags: ["Authentication"], summary: "Update the current academic profile", security: [{ sessionCookie: [], csrfToken: [] }], body: ownProfileBody }
  }, async (request) => {
    if (request.auth.user.pendingLegacyMemberId && !request.auth.user.emailVerifiedAt) throw httpError(403, "EMAIL_NOT_VERIFIED", "Verifique seu email antes de editar o perfil.");
    if (request.body.avatarUrl !== undefined && !validateAvatarUrl(request.body.avatarUrl)) {
      throw httpError(400, "INVALID_AVATAR", "Use a valid profile image.");
    }
    const profile = await store.update((data) => {
      const member = data.members.find((item) => item.id === request.auth.user.memberId);
      const user = data.users.find((item) => item.id === request.auth.user.id);
      if (!member || !user) throw httpError(404, "PROFILE_NOT_FOUND", "Your profile was not found.");
      for (const key of ["displayName", "institution", "course", "academicStage", "avatarUrl"]) {
        if (request.body[key] !== undefined) member[key] = normalizeText(request.body[key]);
      }
      if (request.body.availabilityHours !== undefined) member.availabilityHours = request.body.availabilityHours;
      if (request.body.nickname !== undefined) {
        const nickname = normalizeNickname(request.body.nickname);
        if (!validNickname(nickname)) throw httpError(400, "INVALID_NICKNAME", "Use 3 a 30 letras, números ou sublinhado, começando por uma letra.");
        if (data.users.some(u => u.id !== user.id && u.nickname === nickname)) throw httpError(409, "NICKNAME_EXISTS", "Este nickname já está em uso.");
        user.nickname = nickname;
      }
      user.name = member.displayName;
      user.institution = member.institution;
      user.course = member.course;
      user.academicStage = member.academicStage;
      user.availabilityHours = member.availabilityHours;
      user.avatarUrl = member.avatarUrl || "";
      member.updatedAt = new Date().toISOString();
      user.updatedAt = member.updatedAt;
      return member;
    });
    const data = store.read();
    return { profile: publicMember(data, profile), user: publicUser(data.users.find((item) => item.id === request.auth.user.id), data.environment) };
  });

  app.get("/api/teams", {
    preHandler: [requireAuth],
    schema: { tags: ["Team"], summary: "List available and associated teams", security: [{ sessionCookie: [] }] }
  }, async (request) => {
    const data = store.read();
    return {
      teams: data.teams.filter((team) => sameDemoScope(request.auth.user, team)).map((team) => {
        const membership = team.memberIds.includes(request.auth.user.memberId) ? "member" : "available";
        const canManage = canManageNamedTeam(data, request.auth.user, team);
        const canSeePrivateData = membership === "member" || canManage;
        return {
          id: team.id, name: team.name, description: team.description, createdAt: team.createdAt, updatedAt: team.updatedAt,
          captainMemberId: canSeePrivateData ? team.captainMemberId : null,
          memberIds: canSeePrivateData ? team.memberIds : [],
          artifactIds: canSeePrivateData ? team.artifactIds : [],
          joinRequests: [],
          createdBy: canSeePrivateData ? team.createdBy : null,
          memberCount: team.memberIds.length,
          artifactCount: team.artifactIds.length,
          projectCount: team.projectCount ?? Object.values(data.workspace.projects || {}).filter((record) => record?.document?.context?.teamId === team.id).length,
          membership,
          canManage
        };
      })
    };
  });

  app.get("/api/teams/:id/projects", {
    preHandler: [requireAuth],
    schema: {
      tags: ["Team"], summary: "List a team's projects and project participants", security: [{ sessionCookie: [] }],
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string(100, 1) } }
    }
  }, async (request) => {
    const data = store.read();
    const team = data.teams.find((item) => item.id === request.params.id);
    if (!team) throw httpError(404, "TEAM_NOT_FOUND", "Team was not found.");
    if (!team.memberIds.includes(request.auth.user.memberId) && !canManageNamedTeam(data, request.auth.user, team)) {
      return { projects: Object.values(data.workspace.projects || {}).filter(r => r.document.context?.teamId === team.id && r.document.context?.publicSummary === true).map(r => ({ id: r.document.id, name: r.document.name, projectType: r.document.projectType, public: true, participants: [] })) };
    }
    const projects = Object.values(data.workspace.projects || {})
      .filter((record) => record?.document?.context?.teamId === team.id)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map((record) => {
        const context = record.document.context || {};
        const roles = new Map((context.roles || []).map((item) => [item.id, item.name]));
        const sectors = new Map((context.sectors || []).map((item) => [item.id, item.name]));
        return {
          ...projectSummary(record),
          sectorCount: (context.sectors || []).length,
          hasSystem: Boolean(record.document.engineeringSystem),
          organization: projectOrganization(record.document, data.members),
          participants: (context.assignments || []).map((assignment) => {
            const member = data.members.find((item) => item.id === assignment.memberId);
            return {
              memberId: assignment.memberId,
              displayName: member?.displayName || "Member",
              avatarUrl: member?.avatarUrl || "",
              roleId: assignment.roleId,
              roleName: roles.get(assignment.roleId) || assignment.roleId,
              sectorId: assignment.sectorId,
              sectorName: sectors.get(assignment.sectorId) || ""
            };
          })
        };
      });
    return { projects, validationResetId: data.workspace.validationResetId ?? null };
  });

  app.get("/api/directory/members", {
    preHandler: [requireAuth],
    schema: { tags: ["Team"], summary: "List public member profiles and approximate presence", security: [{ sessionCookie: [] }] }
  }, async (request) => {
    const data = store.read();
    return {
      members: data.users.filter((user) => user.active && (user.id === request.auth.user.id || data.teams.some(team => team.memberIds.includes(user.memberId) && team.memberIds.includes(request.auth.user.memberId)))).map((user) => {
        const member = data.members.find((item) => item.id === user.memberId);
        return {
          id: user.id,
          displayName: member?.displayName || user.name,
          institution: member?.institution || user.institution || "",
          course: member?.course || user.course || "",
          avatarUrl: member?.avatarUrl || user.avatarUrl || "",
          ...presence(data, user)
        };
      })
    };
  });

  app.post("/api/teams", {
    preHandler: [requireAuth, requireCsrf],
    schema: { tags: ["Team"], summary: "Create a team", security: [{ sessionCookie: [], csrfToken: [] }], body: teamBody }
  }, async (request, reply) => {
    const team = await store.update((data) => {
      const timestamp = new Date().toISOString();
      const next = {
        id: (request.auth.user.demoSandboxId ? request.auth.user.demoSandboxId + '-' : '') + randomUUID(),
        name: normalizeText(request.body.name),
        description: normalizeText(request.body.description || ""),
        memberIds: [request.auth.user.memberId],
        artifactIds: [],
        joinRequests: [],
        createdBy: request.auth.user.id,
        captainMemberId: request.auth.user.memberId, adminMemberIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(request.auth.user.demoSandboxId ? { demoSandboxId: request.auth.user.demoSandboxId } : {})
      };
      data.teams.push(next);
      return next;
    });
    reply.code(201);
    return { team: { ...team, membership: "member", canManage: true } };
  });

  app.patch("/api/teams/:id", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Team"], summary: "Update a team", security: [{ sessionCookie: [], csrfToken: [] }],
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string(100, 1) } },
      body: { type: "object", additionalProperties: false, minProperties: 1, properties: { name: string(100, 2), description: string(300), captainMemberId: string(100, 1) } }
    }
  }, async (request) => {
    const team = await store.update((data) => {
      const existing = data.teams.find((item) => item.id === request.params.id);
      requireNamedTeamManager(data, request.auth.user, existing);
      if (request.body.captainMemberId !== undefined) {
        if (!existing.memberIds.includes(request.body.captainMemberId) || !data.users.some(u => u.memberId === request.body.captainMemberId && u.active)) throw httpError(400, "INVALID_CAPTAIN", "Selecione alguém que já pertence à equipe.");
        existing.captainMemberId = request.body.captainMemberId;
      }
      if (request.body.name !== undefined) existing.name = normalizeText(request.body.name);
      if (request.body.description !== undefined) existing.description = normalizeText(request.body.description);
      existing.updatedAt = new Date().toISOString();
      return existing;
    });
    return { team };
  });

  app.delete("/api/teams/:id", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Team"], summary: "Delete a team that is not connected to a project", security: [{ sessionCookie: [], csrfToken: [] }],
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string(100, 1) } }
    }
  }, async (request, reply) => {
    await store.update((data) => {
      const index = data.teams.findIndex((item) => item.id === request.params.id);
      if (index < 0) throw httpError(404, "TEAM_NOT_FOUND", "Team was not found.");
      const team = data.teams[index];
      requireNamedTeamManager(data, request.auth.user, team);
      const projectUsesTeam = Object.values(data.workspace.projects || {}).some((record) => record?.document?.context?.teamId === team.id);
      if (projectUsesTeam) throw httpError(409, "TEAM_IN_USE", "Move or delete the projects connected to this team first.");
      if (data.artifacts.some(a => a.scope === "team" && a.ownerId === team.id)) throw httpError(409, "TEAM_HAS_ARCHIVED_DOCUMENTS", "Esta equipe possui documentos preservados. Exporte-os antes de remover a equipe.");
      for (const invitation of data.invitations.filter(i => i.teamId === team.id && i.status === "pending")) { invitation.status = "cancelled"; delete invitation.tokenHash; }
      data.teams.splice(index, 1);
      return null;
    });
    reply.code(204).send();
  });

  for (const path of ["/api/teams/:id/join-requests", "/api/teams/:id/members", "/api/team/members", "/api/team/members/:id/invitation"]) {
    app.post(path, { preHandler: [requireAuth, requireCsrf] }, async () => {
      throw httpError(410, "INVITATION_REQUIRED", "A entrada em equipes ocorre exclusivamente por convite com aceite do destinatário.");
    });
  }

  app.delete("/api/teams/:id/members/:memberId", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Team"], summary: "Remove a profile from a team without deleting the account", security: [{ sessionCookie: [], csrfToken: [] }],
      params: {
        type: "object",
        additionalProperties: false,
        required: ["id", "memberId"],
        properties: { id: string(100, 1), memberId: string(100, 1) }
      }
    }
  }, async (request, reply) => {
    await store.update((data) => {
      const team = data.teams.find((item) => item.id === request.params.id);
      requireNamedTeamManager(data, request.auth.user, team);
      if (!team.memberIds.includes(request.params.memberId)) throw httpError(404, "MEMBER_NOT_FOUND", "This profile is not part of the team.");
      if (team.captainMemberId === request.params.memberId) throw httpError(409, "CAPTAIN_REQUIRED", "Defina outro capitão antes de remover esta pessoa.");
      team.memberIds = team.memberIds.filter((memberId) => memberId !== request.params.memberId);
      team.joinRequests = team.joinRequests.filter((memberId) => memberId !== request.params.memberId);
      team.updatedAt = new Date().toISOString();
      for (const record of Object.values(data.workspace.projects || {})) {
        if (record?.document?.context?.teamId !== team.id) continue;
        record.document.context.assignments = (record.document.context.assignments || []).filter((assignment) => assignment.memberId !== request.params.memberId);
        record.document.organizationRevision = (record.document.organizationRevision || 0) + 1;
      }
      return null;
    });
    reply.code(204).send();
  });

  app.get("/api/team/members", {
    preHandler: [requireAuth],
    schema: { tags: ["Team"], summary: "List mission team profiles", security: [{ sessionCookie: [] }] }
  }, async (request) => {
    const data = store.read();
    const visibleMemberIds = new Set([request.auth.user.memberId]);
    for (const team of data.teams) {
      if (!team.memberIds.includes(request.auth.user.memberId) && !canManageNamedTeam(data, request.auth.user, team)) continue;
      team.memberIds.forEach((memberId) => visibleMemberIds.add(memberId));

    }
    return { members: data.members.filter((member) => visibleMemberIds.has(member.id)).map((member) => publicMember(data, member)) };
  });

  app.patch("/api/team/members/:id", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Team"],
      summary: "Update a team profile",
      security: [{ sessionCookie: [], csrfToken: [] }],
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string(80, 1) } },
      body: memberPatchBody
    }
  }, async (request) => {
    const currentUser = request.auth.user;
    const isSelf = currentUser.memberId === request.params.id;
    if (!isSelf) requireMemberManager(store.read(), currentUser, request.params.id);
    const member = await store.update((data) => {
      const existing = data.members.find((item) => item.id === request.params.id);
      if (!existing) throw httpError(404, "MEMBER_NOT_FOUND", "Team member was not found.");
      if (!isSelf) requireMemberManager(data, currentUser, existing.id);
      const body = request.body;
      if (body.email !== undefined) {
        const email = normalizeEmail(body.email);
        if (!validateEmail(email)) throw httpError(400, "INVALID_EMAIL", "Enter a valid email address.");
        if (existing.accountId && email !== existing.email) throw httpError(409, "ACCOUNT_EMAIL_LOCKED", "Change an active account email through the account security flow.");
        if (data.members.some((item) => item.id !== existing.id && item.email === email)) throw httpError(409, "MEMBER_EXISTS", "A team profile already uses this email.");
        existing.email = email;
      }
      const ownEditable = ["displayName", "primaryArea", "secondaryAreas", "institution", "course", "academicStage", "skills", "availabilityHours", "notes"];
      const managerEditable = [...ownEditable, "missionRole", "accountStatus"];
      const editable = isSelf && !["owner_admin", "captain", "manager"].includes(currentUser.accessRole) ? ownEditable : managerEditable;
      for (const key of editable) {
        if (body[key] === undefined) continue;
        existing[key] = ["secondaryAreas", "skills"].includes(key) ? normalizeList(body[key]) : normalizeText(body[key]);
      }
      if (existing.secondaryAreas) existing.secondaryAreas = existing.secondaryAreas.filter((area) => area !== existing.primaryArea);
      if (existing.accountId) {
        const account = data.users.find((item) => item.id === existing.accountId);
        if (account) {
          account.name = existing.displayName;
          account.institution = existing.institution;
          account.updatedAt = new Date().toISOString();
        }
      }
      if (body.accessRole !== undefined) {
        requireRole(currentUser, ["owner_admin"]);
        if (!isSelf) throw httpError(403, 'ACCOUNT_ROLE_PRIVATE', 'A administração da equipe não pode alterar o papel de outra conta na plataforma. Use os cargos do projeto.');
        if (!existing.accountId) throw httpError(409, "ACCOUNT_REQUIRED", "This profile does not have an account yet.");
        const account = data.users.find((item) => item.id === existing.accountId);
        if (account?.accessRole === "owner_admin" && body.accessRole !== "owner_admin" && data.users.filter((item) => item.active && item.accessRole === "owner_admin").length === 1) {
          throw httpError(409, "LAST_OWNER", "The team must keep at least one owner administrator.");
        }
        if (account) account.accessRole = body.accessRole;
      }
      existing.updatedAt = new Date().toISOString();
      return existing;
    });
    return { member: publicMember(store.read(), member) };
  });

  app.delete("/api/team/members/:id", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Team"],
      summary: "Remove an unlinked team profile",
      security: [{ sessionCookie: [], csrfToken: [] }],
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string(80, 1) } }
    }
  }, async (request, reply) => {
    requireTeamRole(request.auth.user, ["owner_admin", "captain"], ["captain"]);
    await store.update((data) => {
      const index = data.members.findIndex((item) => item.id === request.params.id);
      if (index < 0) throw httpError(404, "MEMBER_NOT_FOUND", "Team member was not found.");
      requireMemberManager(data, request.auth.user, data.members[index].id);
      if (data.members[index].accountId) throw httpError(409, "MEMBER_HAS_ACCOUNT", "Deactivate the account before removing this profile.");
      const memberId = data.members[index].id;
      data.members.splice(index, 1);
      for (const team of data.teams) team.memberIds = team.memberIds.filter((id) => id !== memberId);
      for (const record of Object.values(data.workspace.projects || {})) {
        const assignments = record?.document?.context?.assignments;
        if (Array.isArray(assignments)) record.document.context.assignments = assignments.filter((assignment) => assignment.memberId !== memberId);
      }
      return null;
    });
    reply.code(204).send();
  });

  app.get("/api/artifacts", {
    preHandler: [requireAuth],
    schema: { tags: ["Artifacts"], summary: "List connected mission sources", security: [{ sessionCookie: [] }] }
  }, async (request) => {
    const data = store.read();
    return { artifacts: visibleArtifacts(data, request.auth.user).map(artifact => artifactForUser(data, request.auth.user, artifact)) };
  });

  app.get("/api/artifacts/:id/content", {
    preHandler: [requireAuth],
    schema: {
      tags: ["Artifacts"],
      summary: "Download the stored bytes of a connected file",
      security: [{ sessionCookie: [] }],
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string(80, 1) } }
    }
  }, async (request, reply) => {
    const data = store.read();
    const artifact = visibleArtifacts(data, request.auth.user).find((item) => item.id === request.params.id);
    if (!artifact) throw httpError(404, "ARTIFACT_NOT_FOUND", "Connected source was not found.");
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(artifact.url || "");
    if (!match || !SAFE_ARTIFACT_MIME_TYPES.has(match[1])) throw httpError(404, "ARTIFACT_NO_CONTENT", "This source is a link; Norte has not stored its file.");
    const fileName = (artifact.fileName || `${artifact.id}`).replace(/[^\w.-]/gu, "_");
    return reply
      .header("Content-Type", match[1])
      .header("Content-Disposition", `${match[1] === "application/pdf" && request.query.download !== "1" ? "inline" : "attachment"}; filename="${fileName}"`)
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .send(Buffer.from(match[2], "base64"));
  });

  app.get("/api/artifacts/:id/pdf", { preHandler: [requireAuth] }, async (request, reply) => {
    const data = store.read(), artifact = visibleArtifacts(data, request.auth.user).find(a => a.id === request.params.id);
    if (!artifact) throw httpError(404, "ARTIFACT_NOT_FOUND", "Artifact not found.");
    if (artifact.documentText === undefined) throw httpError(400, "NOT_DOCUMENT", "Este arquivo deve ser aberto no formato original.");
    const bytes = await renderArtifactPdf(artifact);
    return reply.type("application/pdf").header("Content-Disposition", `${request.query.download === "1" ? "attachment" : "inline"}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(artifact.label)}.pdf`).header("Cache-Control", "private, no-store").send(bytes);
  });

  app.post("/api/artifacts", {
    bodyLimit: MAX_ARTIFACT_BODY_BYTES,
    preHandler: [requireAuth, requireCsrf],
    schema: { tags: ["Artifacts"], summary: "Connect a source or artifact", security: [{ sessionCookie: [], csrfToken: [] }], body: artifactBody }
  }, async (request, reply) => {
    if (request.auth.user.accessRole === "advisor") throw httpError(403, "FORBIDDEN", "Advisors have read-only access to connected sources.");
    const input = cleanArtifactInput(request.body);
    const artifact = await store.update((data) => {
      if (input.scope === "team") {
        const team = data.teams.find((item) => item.id === input.ownerId);
        requireNamedTeamManager(data, request.auth.user, team);
      } else {
        requireArtifactEditor(data, request.auth.user, { ...input, createdBy: request.auth.user.id });
      }
      if (input.entityId && !data.workspace.projects?.[input.ownerId]?.document.engineeringSystem?.entities.some(e => e.id === input.entityId)) throw httpError(400, "INVALID_ENTITY", "Objeto técnico não encontrado.");
      const timestamp = new Date().toISOString();
      const next = { id: randomUUID(), ...input, official: false, createdBy: request.auth.user.id, connectedAt: timestamp, updatedAt: timestamp, ...(request.auth.user.demoSandboxId ? { demoSandboxId: request.auth.user.demoSandboxId } : {}) };
      data.artifacts.push(next);
      if (next.scope === "project") recordActivity(data, request.auth.user.id, next.ownerId, "artifactCreated");
      const project = data.workspace.projects?.[next.ownerId]?.document;
      if (next.scope === "project" && project?.context) {
        project.context.projectArtifactIds = [...new Set([...(project.context.projectArtifactIds || []), next.id])];
        markArtifactMemoryChanged(data, next.id);
      }
      if (next.scope === "team") {
        const team = data.teams.find((item) => item.id === next.ownerId);
        team.artifactIds = [...new Set([...team.artifactIds, next.id])];
        team.updatedAt = timestamp;
      }
      return next;
    });
    reply.code(201);
    return { artifact: artifactForUser(store.read(), request.auth.user, artifact) };
  });

  app.patch("/api/artifacts/:id", {
    bodyLimit: MAX_ARTIFACT_BODY_BYTES,
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Artifacts"],
      summary: "Update a connected source",
      security: [{ sessionCookie: [], csrfToken: [] }],
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string(80, 1) } },
      body: artifactPatchBody
    }
  }, async (request) => {
    const artifact = await store.update((data) => {
      const existing = data.artifacts.find((item) => item.id === request.params.id);
      if (!existing) throw httpError(404, "ARTIFACT_NOT_FOUND", "Connected source was not found.");
      if (existing.official && existing.createdBy !== request.auth.user.id) throw httpError(403, "FORBIDDEN", "Somente quem publicou a fonte oficial pode alterá-la.");
      else if (existing.scope === "team") requireNamedTeamManager(data, request.auth.user, data.teams.find((team) => team.id === existing.ownerId));
      else requireArtifactEditor(data, request.auth.user, existing);
      if ((request.body.scope !== undefined && request.body.scope !== existing.scope) || (request.body.ownerId !== undefined && request.body.ownerId !== existing.ownerId)) throw httpError(400, "ARTIFACT_OWNERSHIP", "Use pastas para mover arquivos dentro do mesmo projeto.");
      const candidate = { ...existing, ...request.body, scope: existing.scope, ownerId: existing.ownerId };
      if (request.body.url !== undefined && request.body.documentText === undefined) delete candidate.documentText;
      const merged = cleanArtifactInput(candidate);
      if (existing.scope !== "team") requireArtifactEditor(data, request.auth.user, merged);
      if (merged.entityId && !data.workspace.projects?.[merged.ownerId]?.document.engineeringSystem?.entities.some(e => e.id === merged.entityId)) throw httpError(400, "INVALID_ENTITY", "Objeto técnico não encontrado.");
      if (request.body.expectedRevision !== (existing.revision || 0)) throw httpError(409, "ARTIFACT_CHANGED", "Este documento foi alterado ou sua revisão não foi informada. Recarregue a versão atual antes de salvar; seu formulário foi mantido.");
      if (merged.documentText === undefined) delete existing.documentText;
      Object.assign(existing, merged, { revision: (existing.revision || 0) + 1, updatedAt: new Date().toISOString() });
      markArtifactMemoryChanged(data, existing.id);
      if (existing.scope === "project") recordActivity(data, request.auth.user.id, existing.ownerId, "artifactEdited");
      return existing;
    });
    return { artifact: artifactForUser(store.read(), request.auth.user, artifact) };
  });

  app.delete("/api/artifacts/:id", {
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["Artifacts"],
      summary: "Disconnect a non-official source",
      security: [{ sessionCookie: [], csrfToken: [] }],
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string(80, 1) } }
    }
  }, async (request, reply) => {
    await store.update((data) => {
      const index = data.artifacts.findIndex((item) => item.id === request.params.id);
      if (index < 0) throw httpError(404, "ARTIFACT_NOT_FOUND", "Connected source was not found.");
      const artifact = data.artifacts[index];
      if (artifact.official) throw httpError(409, "OFFICIAL_SOURCE", "Official mission references cannot be disconnected.");
      if (artifact.scope === "team") requireNamedTeamManager(data, request.auth.user, data.teams.find((team) => team.id === artifact.ownerId));
      else requireArtifactEditor(data, request.auth.user, artifact);
      markArtifactMemoryChanged(data, artifact.id);
      data.artifacts.splice(index, 1);
      for (const team of data.teams) team.artifactIds = team.artifactIds.filter((id) => id !== artifact.id);
      for (const record of Object.values(data.workspace.projects || {})) {
        const context = record?.document?.context;
        if (!context) continue;
        context.teamArtifactIds = (context.teamArtifactIds || []).filter((id) => id !== artifact.id);
        if (context.teamArtifactFolders) delete context.teamArtifactFolders[artifact.id];
        context.projectArtifactIds = (context.projectArtifactIds || []).filter((id) => id !== artifact.id);
        if (context.programArtifactIds) context.programArtifactIds = context.programArtifactIds.filter((id) => id !== artifact.id);
      }
      return null;
    });
    reply.code(204).send();
  });

  app.get("/api/brainstorm-ai/status", {
    preHandler: [requireAuth],
    schema: { tags: ["System"], summary: "Check the private organization engine", security: [{ sessionCookie: [] }] }
  }, async () => ai.status());

  app.post("/api/brainstorm-ai/analyze", {
    preHandler: [requireAuth, requireCsrf],
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    schema: {
      tags: ["System"],
      summary: "Analyze or organize a brainstorming map",
      security: [{ sessionCookie: [], csrfToken: [] }],
      body: brainstormRequestSchema
    }
  }, async (request) => ai.analyze(request.body));

  app.get("/api/system-ai/status", {
    preHandler: [requireAuth],
    schema: { tags: ["System"], summary: "Check engineering extraction availability", security: [{ sessionCookie: [] }] }
  }, async () => systemAi.status());

  const extractionBody = { type: 'object', additionalProperties: false, required: ['projectId'], properties: { projectId: string(160, 1), language: { enum: ['pt', 'en'] }, regenerate: { type: 'boolean' }, reviewed: { type: 'boolean' }, autoRun: { type: 'boolean' } } };
  const extractionDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  function extractionProject(data, user, projectId) {
    user = data.users.find(candidate => candidate.id === user?.id && candidate.active);
    if (!user) throw httpError(403, 'FORBIDDEN', 'Sua conta não possui mais acesso a esta operação.');
    const record = data.workspace.projects?.[projectId];
    if (!record || !canAccessProject(data, user, record)) throw httpError(404, 'PROJECT_NOT_FOUND', 'Projeto não disponível para sua conta.');
    if (user.accessRole === 'advisor') throw httpError(403, 'FORBIDDEN', 'Conta de leitura.');
    requireProjectAdmin(record, user);
    return record;
  }
  function extractionUnchanged(job, data, record) {
    const user = data.users.find(candidate => candidate.id === job.userId && candidate.active);
    const readable = new Set(user ? visibleArtifacts(data, user).map(artifact => artifact.id) : []);
    if (projectArtifacts(record.document, data.artifacts).some(artifact => !readable.has(artifact.id))) throw httpError(409, 'PROJECT_MEMORY_CHANGED', 'Uma fonte deixou de estar disponível para sua conta. Atualize a memória antes de continuar.');
    if (job.snapshotHash !== extractionDigest(projectMemorySnapshot(record.document, data.artifacts))) throw httpError(409, 'PROJECT_MEMORY_CHANGED', 'Os documentos mudaram. Inicie uma nova extração; trechos iguais serão reutilizados.');
    if (job.baselineHash !== extractionDigest(record.document.engineeringSystem || null)) throw httpError(409, 'SYSTEM_CHANGED', 'O mapa foi corrigido durante a extração. Inicie uma nova proposta para preservar essas alterações.');
  }
  function extractionGuard(job, { allowApplied = false } = {}) {
    return async () => {
      await store.refresh?.();
      const data = store.read(), record = extractionProject(data, { id: job.userId }, job.projectId);
      if (!allowApplied || !job.applied) extractionUnchanged(job, data, record);
    };
  }
  async function persistExtraction(id, job) {
    await store.update(data => {
      const record = extractionProject(data, { id: job.userId }, job.projectId);
      if (!job.applied) extractionUnchanged(job, data, record);
      data.workspace.extractionJobs ||= {}; data.workspace.extractionJobs[id] = structuredClone(job);
    });
    extractionJobs.set(id, job);
  }
  async function extractionState(id, job, { summary = false } = {}) {
    await extractionGuard(job, { allowApplied: true })();
    let result;
    try { result = await systemAi.job(id, { scopeKey: job.scopeKey, summary }); }
    catch (error) {
      if (!['EXTRACTION_JOB_NOT_FOUND', 'EXTRACTION_NOT_FOUND'].includes(error.code) || typeof systemAi.restore !== 'function') throw error;
      const data = store.read(), record = extractionProject(data, { id: job.userId }, job.projectId);
      if (!job.applied) extractionUnchanged(job, data, record);
      const restored = await systemAi.restore(id, record.document, data.artifacts, job.language, { scopeKey: job.scopeKey, autoRun: !job.applied && job.autoRun, assertAuthorized: extractionGuard(job) });
      if (!restored) throw httpError(409, 'EXTRACTION_CHECKPOINT_UNAVAILABLE', 'O progresso não está mais disponível neste servidor. Inicie uma nova extração; os documentos e a versão salva do mapa foram mantidos.');
      result = await systemAi.job(id, { scopeKey: job.scopeKey, summary });
    }
    // Read access alone is insufficient if source membership changed during an
    // asynchronous provider/read operation. Never return its old quotations.
    await extractionGuard(job, { allowApplied: true })();
    if (!summary) return result;
    const compact = { ...result }; delete compact.result; return compact;
  }
  function extractionJob(request) {
    const job = extractionJobs.get(request.params.jobId);
    const projectId = request.body?.projectId || request.query.projectId;
    if (!job || job.userId !== request.auth.user.id || job.projectId !== projectId) throw httpError(404, 'EXTRACTION_NOT_FOUND', 'Extração não disponível para sua conta.');
    extractionProject(store.read(), request.auth.user, job.projectId);
    return job;
  }
  const extractionView = (result, job) => ({ ...result, projectId: job.projectId, applied: job.applied, regenerate: job.regenerate, autoRun: job.autoRun });
  app.post('/api/system-ai/jobs', { preHandler: [requireAuth, requireCsrf], config: { rateLimit: { max: 12, timeWindow: '1 hour' } }, schema: { body: extractionBody } }, async (request, reply) => {
    if (typeof systemAi.start !== 'function') throw httpError(503, 'EXTRACTION_UNAVAILABLE', 'A extração em etapas ainda não está disponível.');
    const data = store.read(), record = extractionProject(data, request.auth.user, request.body.projectId);
    if (record.document.engineeringSystem && request.body.regenerate !== true) throw httpError(409, 'SYSTEM_ALREADY_EXISTS', 'Use a atualização do mapa para revisar uma proposta antes de substituir a versão atual.');
    const scopeKey = request.auth.user.id + ':' + record.document.id;
    const metadata = { userId: request.auth.user.id, projectId: record.document.id, scopeKey,
      snapshotHash: extractionDigest(projectMemorySnapshot(record.document, data.artifacts)), baselineHash: extractionDigest(record.document.engineeringSystem || null),
      feedbackHash: extractionDigest(await (systemAiOptions.feedbackContext || intelligence.feedbackContext)(record.document) || null),
      language: request.body.language || 'en', autoRun: request.body.autoRun !== false, regenerate: request.body.regenerate === true, createdAt: Date.now(), applied: false };
    const startKey = extractionDigest([scopeKey, metadata.snapshotHash, metadata.baselineHash, metadata.language, metadata.feedbackHash]);
    let operation = extractionStarts.get(startKey);
    if (!operation) {
      operation = (async () => {
        const previous = [...extractionJobs.entries()].reverse().find(([, job]) => job.scopeKey === scopeKey && job.snapshotHash === metadata.snapshotHash && job.baselineHash === metadata.baselineHash && job.language === metadata.language && job.feedbackHash === metadata.feedbackHash && !job.applied);
        if (previous) {
          const [id, job] = previous;
          try {
            let result = await extractionState(id, job);
            if (metadata.autoRun && result.status === 'paused') {
              job.autoRun = true;
              await persistExtraction(id, job);
              result = await systemAi.resume(id, { scopeKey, autoRun: true, assertAuthorized: extractionGuard(job) });
            }
            return extractionView(result, job);
          } catch (error) { if (error.code !== 'EXTRACTION_CHECKPOINT_UNAVAILABLE') throw error; }
        }
        const result = await systemAi.start(record.document, data.artifacts, metadata.language, { scopeKey, autoRun: metadata.autoRun, assertAuthorized: extractionGuard(metadata) });
        await store.refresh?.();
        const current = store.read(), latest = extractionProject(current, request.auth.user, record.document.id);
        extractionUnchanged(metadata, current, latest);
        if (!result?.jobId) throw httpError(502, 'EXTRACTION_INVALID', 'O serviço não retornou uma identificação de extração.');
        await persistExtraction(result.jobId, metadata);
        return extractionView(result, metadata);
      })();
      extractionStarts.set(startKey, operation);
    }
    try {
      const result = await operation;
      await extractionGuard(metadata)();
      reply.code(202); return result;
    } finally { if (extractionStarts.get(startKey) === operation) extractionStarts.delete(startKey); }
  });
  app.get('/api/system-ai/jobs/latest', { preHandler: [requireAuth] }, async request => {
    const data = store.read(), record = extractionProject(data, request.auth.user, request.query.projectId);
    const candidates = [...extractionJobs.entries()].filter(([, job]) => job.userId === request.auth.user.id && job.projectId === record.document.id).sort((a, b) => b[1].createdAt - a[1].createdAt);
    for (const [id, job] of candidates) {
      // A published version is already in the project. Do not resurrect its old
      // proposal or a stale proposal after source edits when returning to a tab.
      if (job.applied || record.extractionJobId === id) return { job: null };
      try {
        extractionUnchanged(job, data, record);
        const result = await extractionState(id, job, { summary: true });
        return { job: extractionView(result, job) };
      } catch (error) { if (!['PROJECT_MEMORY_CHANGED', 'SYSTEM_CHANGED', 'EXTRACTION_CHECKPOINT_UNAVAILABLE'].includes(error.code)) throw error; }
    }
    return { job: null };
  });
  app.get('/api/system-ai/jobs/:jobId', { preHandler: [requireAuth] }, async request => {
    const job = extractionJob(request);
    if (job.applied) {
      await extractionGuard(job, { allowApplied: true })();
      return extractionView({ jobId: request.params.jobId, status: 'completed' }, job);
    }
    const result = await extractionState(request.params.jobId, job, { summary: request.query.summary === 'true' });
    return extractionView(result, job);
  });
  app.post('/api/system-ai/jobs/:jobId/resume', { preHandler: [requireAuth, requireCsrf], config: { rateLimit: { max: 120, timeWindow: '1 hour' } }, schema: { body: extractionBody } }, async (request, reply) => {
    const job = extractionJob(request), data = store.read(), record = extractionProject(data, request.auth.user, job.projectId);
    extractionUnchanged(job, data, record);
    await extractionState(request.params.jobId, job, { summary: true });
    job.autoRun = request.body.autoRun !== false;
    await persistExtraction(request.params.jobId, job);
    const result = await systemAi.resume(request.params.jobId, { scopeKey: job.scopeKey, autoRun: job.autoRun, assertAuthorized: extractionGuard(job) });
    await extractionGuard(job)();
    reply.code(202); return extractionView(result, job);
  });
  app.post('/api/system-ai/jobs/:jobId/apply', { preHandler: [requireAuth, requireCsrf], schema: { body: extractionBody } }, async request => {
    const job = extractionJob(request);
    if (job.applied) {
      const record = extractionProject(store.read(), request.auth.user, job.projectId);
      if (record.extractionJobId !== request.params.jobId) throw httpError(409, 'SYSTEM_CHANGED', 'Uma versão mais recente do mapa já foi salva.');
      return { engineeringSystem: record.document.engineeringSystem, memoryRevision: record.document.memoryRevision || 0, project: record.document, revision: record.revision, regenerated: job.regenerate };
    }
    const result = await extractionState(request.params.jobId, job);
    if (result.status !== 'completed' || !result.result) throw httpError(409, 'EXTRACTION_INCOMPLETE', 'Aguarde a conclusão e revise os avisos de cobertura.');
    if (result.report?.needsReview && request.body.reviewed !== true) throw httpError(409, 'EXTRACTION_REQUIRES_REVIEW', 'Revise as omissões e os avisos antes de aplicar este mapa.');
    const applied = await store.update(data => {
      const record = extractionProject(data, data.users.find(user => user.id === request.auth.user.id && user.active), job.projectId);
      if (record.extractionJobId === request.params.jobId) return { engineeringSystem: record.document.engineeringSystem, memoryRevision: record.document.memoryRevision || 0, project: record.document, revision: record.revision, regenerated: job.regenerate };
      extractionUnchanged(job, data, record);
      if (record.document.engineeringSystem && (!job.regenerate || request.body.regenerate !== true)) throw httpError(409, 'SYSTEM_REPLACEMENT_REQUIRES_REVIEW', 'Confirme a substituição após revisar a proposta; a versão anterior será preservada.');
      const engineeringSystem = result.result.engineeringSystem || result.result;
      if (!validateEngineeringSystem(engineeringSystem)) throw httpError(502, 'EXTRACTION_INVALID', 'O mapa extraído não passou na validação.');
      if (record.document.engineeringSystem) {
        record.engineeringHistory ||= [];
        record.engineeringHistory.push({ id: randomUUID(), archivedAt: new Date().toISOString(), archivedBy: request.auth.user.id, engineeringSystem: structuredClone(record.document.engineeringSystem), extractionReport: structuredClone(record.extractionReport || null) });
      }
      record.document.engineeringSystem = engineeringSystem;
      record.document.systemGeneratedFromRevision = engineeringSystem.generatedFromRevision;
      record.document.phaseProgress = { highestUnlockedStep: Math.max(1, record.document.phaseProgress?.highestUnlockedStep || 0) };
      record.document.updatedAt = new Date().toISOString();
      record.revision = (record.revision || 0) + 1; record.updatedAt = record.document.updatedAt; record.updatedBy = request.auth.user.id;
      if (data.workspace.project?.document?.id === job.projectId) data.workspace.project = record;
      record.extractionJobId = request.params.jobId;
      data.workspace.extractionJobs ||= {};
      data.workspace.extractionJobs[request.params.jobId] = { ...job, applied: true };
      record.extractionReport = { ...structuredClone(result.report || {}), progress: structuredClone(result.progress || {}), completedAt: record.updatedAt };
      return { engineeringSystem, memoryRevision: record.document.memoryRevision || 0, project: record.document, revision: record.revision, regenerated: job.regenerate };
    });
    job.applied = true;
    return applied;
  });

  app.post("/api/system-ai/generate", {
    preHandler: [requireAuth, requireCsrf],
    config: { rateLimit: { max: 12, timeWindow: "1 hour" } },
    schema: { tags: ["System"], summary: "Initialize engineering architecture from this project's persisted artifacts", security: [{ sessionCookie: [], csrfToken: [] }], body: generationRequestSchema }
  }, async (request) => {
    const data = store.read();
    const record = data.workspace.projects?.[request.body.projectId];
    if (!record) throw httpError(404, "PROJECT_NOT_FOUND", "Project was not found.");
    if (!canAccessProject(data, request.auth.user, record)) throw httpError(403, "FORBIDDEN", "You cannot open this project.");
    if (request.auth.user.accessRole === "advisor") throw httpError(403, "FORBIDDEN", "Advisors have read-only access to the project workspace.");
    requireProjectAdmin(record, request.auth.user);
    const project = record.document;
    if (project.engineeringSystem) return { engineeringSystem: project.engineeringSystem, memoryRevision: project.memoryRevision || 0 };
    const operationKey = project.id;
    if (initializingSystems.has(operationKey)) return initializingSystems.get(operationKey);
    const memorySnapshot = projectMemorySnapshot(project, data.artifacts);
    const operation = (async () => {
      const engineeringSystem = await systemAi.generate(project, data.artifacts, request.body.language);
      return store.update((current) => {
        const latest = current.workspace.projects?.[project.id];
        if (!latest) throw httpError(409, "PROJECT_CHANGED", "This project changed during initialization.");
        requireProjectAdmin(latest, current.users.find(user => user.id === request.auth.user.id && user.active));
        if (!canAccessProject(current, request.auth.user, latest)) throw httpError(403, "FORBIDDEN", "Project access changed during initialization.");
        if (latest.document.engineeringSystem) return { engineeringSystem: latest.document.engineeringSystem, memoryRevision: latest.document.memoryRevision || 0 };
        // PostgreSQL JSONB may reorder object keys on its transaction round trip.
        // Compare values, preserving array order and every actual memory change.
        if (!isDeepStrictEqual(memorySnapshot, projectMemorySnapshot(latest.document, current.artifacts))) throw httpError(409, "PROJECT_MEMORY_CHANGED", "Project memory changed during initialization. Retry with the current memory.");
        latest.document = { ...latest.document, engineeringSystem, phaseProgress: { highestUnlockedStep: 1 }, systemGeneratedFromRevision: engineeringSystem.generatedFromRevision, updatedAt: new Date().toISOString() };
        latest.revision = (latest.revision || 0) + 1;
        latest.updatedAt = latest.document.updatedAt;
        latest.updatedBy = request.auth.user.id;
        if (current.workspace.project?.document?.id === project.id) current.workspace.project = latest;
        return { engineeringSystem, memoryRevision: latest.document.memoryRevision || 0 };
      });
    })();
    initializingSystems.set(operationKey, operation);
    try { return await operation; } finally { initializingSystems.delete(operationKey); }
  });

  app.post("/api/system-ai/interpret-hypothesis", {
    preHandler: [requireAuth, requireCsrf],
    config: { rateLimit: { max: 60, timeWindow: "1 hour" } },
    schema: { tags: ["System"], summary: "Interpret a canvas hypothesis against the saved architecture", body: interpretationRequestSchema }
  }, async (request) => {
    const data = store.read();
    const record = data.workspace.projects?.[request.body.projectId];
    if (!record) throw httpError(404, "PROJECT_NOT_FOUND", "Project was not found.");
    if (!canAccessProject(data, request.auth.user, record) || request.auth.user.accessRole === "advisor") throw httpError(403, "FORBIDDEN", "You cannot change this project.");
    const baseline = record.document.engineeringSystem;
    const deliveryRevision = data.workspace.delivery?.[record.document.id]?.revision || 0;
    if (!baseline) throw httpError(409, "SYSTEM_NOT_READY", "Initialize the project architecture first.");
    const result = await systemAi.interpret(baseline, request.body.text, request.body.language, { ...request.body, project: record.document, actorId: request.auth.user.id });
    const current = store.read(), latest = current.workspace.projects?.[request.body.projectId];
    if (!latest || !canAccessProject(current, request.auth.user, latest)) throw httpError(403, "FORBIDDEN", "Project access changed.");
    if (!isDeepStrictEqual(baseline, latest.document.engineeringSystem)) throw httpError(409, "SYSTEM_CHANGED", "The architecture changed. Interpret the idea again.");
    if ((current.workspace.delivery?.[record.document.id]?.revision || 0) !== deliveryRevision) throw httpError(409, "PROJECT_CONTEXT_CHANGED", "Os requisitos mudaram. Interprete a ideia novamente.");
    const analysis = intelligence.analysisContext(record.document.id, request.auth.user.id);
    return { ...result, baselineId: baseline.id, baselineRevision: baseline.revision || 0, baselineGeneratedAt: baseline.generatedAt, analysisModel: analysis.model, deliveryRevision: analysis.deliveryRevision };
  });

  app.get('/api/projects/:id/analysis-context', { preHandler: [requireAuth] }, async request => {
    const data = store.read(), record = data.workspace.projects?.[request.params.id];
    if (!record || !canAccessProject(data, request.auth.user, record)) throw httpError(404, 'PROJECT_NOT_FOUND', 'Projeto não disponível.');
    const baseline = record.document.engineeringSystem;
    if (!baseline) throw httpError(409, 'SYSTEM_NOT_READY', 'Crie ou revise a arquitetura primeiro.');
    const analysis = intelligence.analysisContext(record.document.id, request.auth.user.id);
    return { analysisModel: analysis.model, deliveryRevision: analysis.deliveryRevision, baselineId: baseline.id, baselineRevision: baseline.revision || 0, baselineGeneratedAt: baseline.generatedAt };
  });

  const projectParams = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: string(100, 1) }
  };

  app.get("/api/projects", {
    preHandler: [requireAuth],
    schema: { tags: ["System"], summary: "List projects associated with the account", security: [{ sessionCookie: [] }] }
  }, async (request) => {
    const data = store.read();
    const projects = Object.values(data.workspace.projects || {})
      .filter((record) => canAccessProject(data, request.auth.user, record))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map(projectSummary);
    return { projects, validationResetId: data.workspace.validationResetId ?? null };
  });

  app.post("/api/projects", {
    bodyLimit: 32 * 1024 * 1024,
    preHandler: [requireAuth, requireCsrf],
    schema: { tags: ["System"], summary: "Create a project", security: [{ sessionCookie: [], csrfToken: [] }], body: { type: "object", additionalProperties: true } }
  }, async (request, reply) => {
    if (!validProjectDocument(request.body)) throw httpError(400, "INVALID_PROJECT", "The project document is invalid or unsupported.");
    request.body.context = { roles: [{ id: "captain", name: "Responsável pelo projeto" }, { id: "manager", name: "Gerente" }, { id: "member", name: "Membro" }, { id: "advisor", name: "Orientador" }], sectors: [], folders: [], assignments: [], teamArtifactIds: [], projectArtifactIds: [], ...request.body.context };
    if (request.auth.user.accessRole === "advisor") throw httpError(403, "FORBIDDEN", "Read-only account.");
    if (typeof request.body.name !== "string" || !request.body.name.trim() || request.body.name.length > 120 || !/^(?!__proto__$)(?!constructor$)(?!prototype$)[A-Za-z0-9._:-]+$/.test(request.body.id)) throw httpError(400, "INVALID_PROJECT", "Informe um nome válido para o projeto.");
    const record = await store.update((data) => {
      if (data.workspace.projects[request.body.id]) throw httpError(409, "PROJECT_EXISTS", "A project with this identifier already exists.");
      const teamId = request.body.context?.teamId;
      if (teamId) {
        const team = data.teams.find((item) => item.id === teamId);
        if (!team || !sameDemoScope(request.auth.user, team) || !team.memberIds.includes(request.auth.user.memberId)) throw httpError(403, "FORBIDDEN", "Join the selected team before creating this project.");
      }
      const timestamp = new Date().toISOString();
      request.body.creatorId = request.auth.user.id;
      if (request.auth.user.demoSandboxId) request.body.demoSandboxId = request.auth.user.demoSandboxId;
      else delete request.body.demoSandboxId;
      request.body.organizationRevision = 0;
      validateProjectOrganization(data, null, request.body, request.auth.user);
      request.body.name = request.body.name.trim();
      request.body.createdAt = timestamp;
      request.body.updatedAt = timestamp;
      const next = { document: request.body, revision: 1, createdAt: timestamp, createdBy: request.auth.user.id, updatedAt: timestamp, updatedBy: request.auth.user.id, ...(request.auth.user.demoSandboxId ? { demoSandboxId: request.auth.user.demoSandboxId } : {}) };
      data.workspace.projects[request.body.id] = next;
      data.workspace.project = next;
      return next;
    });
    reply.code(201);
    return { project: record.document, revision: record.revision, updatedAt: record.updatedAt };
  });

  app.get("/api/projects/:id", {
    preHandler: [requireAuth],
    schema: { tags: ["System"], summary: "Open an associated project", security: [{ sessionCookie: [] }], params: projectParams }
  }, async (request) => {
    const data = store.read();
    const record = data.workspace.projects?.[request.params.id];
    if (!record) throw httpError(404, "PROJECT_NOT_FOUND", "Project was not found.");
    if (!canAccessProject(data, request.auth.user, record)) throw httpError(403, "FORBIDDEN", "You cannot open this project.");
    return { project: record.document, revision: record.revision, updatedAt: record.updatedAt };
  });

  app.get('/api/projects/:id/system-history', { preHandler: [requireAuth], schema: { params: projectParams } }, async request => {
    const record = extractionProject(store.read(), request.auth.user, request.params.id);
    return { versions: record.engineeringHistory || [], extractionReport: record.extractionReport || null };
  });

  app.put("/api/projects/:id", {
    bodyLimit: 32 * 1024 * 1024,
    preHandler: [requireAuth, requireCsrf],
    schema: { tags: ["System"], summary: "Persist an associated project", security: [{ sessionCookie: [], csrfToken: [] }], params: projectParams, body: { type: "object", additionalProperties: true } }
  }, async (request) => {
    if (request.auth.user.accessRole === "advisor") throw httpError(403, "FORBIDDEN", "Advisors have read-only access to the project workspace.");
    if (request.body.id !== request.params.id || !validProjectDocument(request.body)) throw httpError(400, "INVALID_PROJECT", "The project document is invalid or unsupported.");
    return store.update((data) => {
      const previous = data.workspace.projects?.[request.params.id];
      if (!previous) throw httpError(404, "PROJECT_NOT_FOUND", "Project was not found.");
      if (!canAccessProject(data, request.auth.user, previous)) throw httpError(403, "FORBIDDEN", "You cannot update this project.");
      const nextTeamId = request.body.context?.teamId;
      if (nextTeamId) {
        const nextTeam = data.teams.find((item) => item.id === nextTeamId);
        if (!nextTeam || !sameDemoScope(request.auth.user, nextTeam) || !nextTeam.memberIds.includes(request.auth.user.memberId)) {
          throw httpError(403, "FORBIDDEN", "Join the selected team before connecting it to this project.");
        }
      }
      request.body.context = { ...previous.document.context, ...request.body.context };
      request.body.creatorId ??= previous.document.creatorId;
      if (previous.demoSandboxId) request.body.demoSandboxId = previous.demoSandboxId;
      else delete request.body.demoSandboxId;
      const memoryLinks = data.artifacts.filter(a => a.scope === "project" && a.ownerId === request.params.id).map(a => a.id);
      // Project-owned files cannot be unlinked independently of deletion. Preserve
      // uploads made while another tab was saving an older project snapshot.
      if (request.body.context) request.body.context.projectArtifactIds = memoryLinks;
      const organization = project => ({ teamId: project.context?.teamId, roles: project.context?.roles, sectors: project.context?.sectors, folders: project.context?.folders, teamArtifactFolders: project.context?.teamArtifactFolders, assignments: project.context?.assignments, teamArtifactIds: project.context?.teamArtifactIds });
      const changedOrganization = !isDeepStrictEqual(organization(previous.document), organization(request.body));
      if (changedOrganization && (request.body.organizationRevision || 0) !== (previous.document.organizationRevision || 0)) throw httpError(409, "ORGANIZATION_CHANGED", "A organização foi alterada por outra pessoa. Recarregue o projeto antes de salvar.");
      validateProjectOrganization(data, previous, request.body, request.auth.user);
      request.body.organizationRevision = (previous.document.organizationRevision || 0) + (changedOrganization ? 1 : 0);
      const record = {
        ...previous,
        document: preserveProjectProgress(previous.document, request.body),
        revision: (previous.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: request.auth.user.id
      };
      data.workspace.projects[request.params.id] = record;
      intelligence.captureMapCorrections?.(data, previous.document, record.document, request.auth.user.id);
      if (changedOrganization) recordActivity(data, request.auth.user.id, record.document.id, "organizationUpdated");
      data.workspace.project = record;
      return { project: record.document, revision: record.revision, updatedAt: record.updatedAt };
    });
  });

  app.delete("/api/projects/:id", {
    preHandler: [requireAuth, requireCsrf],
    schema: { tags: ["System"], summary: "Delete a project and its project-scoped artifacts", security: [{ sessionCookie: [], csrfToken: [] }], params: projectParams }
  }, async (request, reply) => {
    await store.update((data) => {
      const record = data.workspace.projects?.[request.params.id];
      if (!record) throw httpError(404, "PROJECT_NOT_FOUND", "Project was not found.");
      if (!canAccessProject(data, request.auth.user, record)) throw httpError(403, "FORBIDDEN", "Project access denied.");
      requireProjectAdmin(record, request.auth.user);

      data.artifacts = data.artifacts.filter((artifact) => !(artifact.scope === "project" && artifact.ownerId === request.params.id));
      delete data.workspace.projects[request.params.id];
      delete data.workspace.labs?.[request.params.id];
      delete data.workspace.delivery?.[request.params.id];
      delete data.projectLearning?.[request.params.id];
      delete data.workspace.configurationChanges?.[request.params.id];
      delete data.workspace.ideaBudgets?.[request.params.id];
      delete data.workspace.ideaAnalysisBudgets?.[request.params.id];
      data.workspace.ideaStarterCache = {};
      for (const [key, cached] of Object.entries(data.workspace.ideaAnalysisCache || {})) if (cached.projectId === request.params.id) delete data.workspace.ideaAnalysisCache[key];
      for (const [id, conversation] of Object.entries(data.platform?.conversations || {})) if (conversation.projectId === request.params.id) delete data.platform.conversations[id];
      for (const [id, session] of Object.entries(data.workspace.ideaSessions || {})) if (session.projectId === request.params.id) delete data.workspace.ideaSessions[id];
      if (data.workspace.project?.document?.id === request.params.id) {
        data.workspace.project = Object.values(data.workspace.projects).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] || null;
      }
      return null;
    });
    reply.code(204).send();
  });

  app.get("/api/workspace/project", { preHandler: [requireAuth] }, async (request) => {
    const data = store.read(), record = data.workspace.project;
    if (record && !canAccessProject(data, request.auth.user, record)) throw httpError(403, "FORBIDDEN", "You cannot open this project.");
    return { project: record?.document ?? null, revision: record?.revision ?? 0, updatedAt: record?.updatedAt ?? null, validationResetId: data.workspace.validationResetId ?? null };
  });
  app.put("/api/workspace/project", { bodyLimit: 32 * 1024 * 1024, preHandler: [requireAuth, requireCsrf] }, async (request, reply) => {
    if (!validProjectDocument(request.body)) throw httpError(400, "INVALID_PROJECT", "Invalid project.");
    const exists = store.read().workspace.projects?.[request.body.id];
    const response = await app.inject({ method: exists ? "PUT" : "POST", url: exists ? `/api/projects/${encodeURIComponent(request.body.id)}` : "/api/projects", headers: { cookie: request.headers.cookie, "x-csrf-token": request.headers["x-csrf-token"] }, payload: request.body });
    return reply.code(response.statusCode === 201 ? 200 : response.statusCode).send(response.json());
  });

  const labParams = {
    type: "object",
    additionalProperties: false,
    required: ["projectId"],
    properties: {
      projectId: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        pattern: "^(?!__proto__$)(?!constructor$)(?!prototype$)[A-Za-z0-9._:-]+$"
      }
    }
  };

  app.get("/api/workspace/labs/:projectId", {
    preHandler: [requireAuth],
    schema: { tags: ["System"], summary: "Read a shared exploration map", security: [{ sessionCookie: [] }], params: labParams }
  }, async (request) => {
    const data = store.read(), project = data.workspace.projects?.[request.params.projectId];
    if (!project || !canAccessProject(data, request.auth.user, project)) throw httpError(403, "FORBIDDEN", "You cannot open this project.");
    const record = data.workspace.labs[request.params.projectId];
    return { board: record?.document ?? null, revision: record?.revision ?? 0, updatedAt: record?.updatedAt ?? null };
  });

  app.put("/api/workspace/labs/:projectId", {
    bodyLimit: 4 * 1024 * 1024,
    preHandler: [requireAuth, requireCsrf],
    schema: {
      tags: ["System"],
      summary: "Persist a shared exploration map",
      security: [{ sessionCookie: [], csrfToken: [] }],
      params: labParams,
      body: { type: "object", additionalProperties: true }
    }
  }, async (request) => {
    if (request.auth.user.accessRole === "advisor") throw httpError(403, "FORBIDDEN", "Advisors have read-only access to the project workspace.");
    if (!validLabBoard(request.body)) throw httpError(400, "INVALID_LAB_BOARD", "The exploration map is invalid or unsupported.");
    return store.update((data) => {
      const project = data.workspace.projects?.[request.params.projectId];
      if (!project || !canAccessProject(data, request.auth.user, project)) throw httpError(403, "FORBIDDEN", "You cannot update this project.");
      const previous = data.workspace.labs[request.params.projectId];
      const record = {
        document: preserveProjectProgress(previous?.document, request.body),
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: request.auth.user.id
      };
      data.workspace.labs[request.params.projectId] = record;
      return { board: record.document, revision: record.revision, updatedAt: record.updatedAt };
    });
  });

  if (options.serveStatic ?? production) {
    await app.register(fastifyStatic, { root: resolve("dist"), prefix: "/" });
  }

  app.decorate("missionStore", store);
  app.addHook("onReady", async () => {
    if (typeof systemAi.restore !== 'function') return;
    // Only explicitly started background jobs are recovered. No old demo map or
    // failed attempt is regenerated silently during server startup.
    for (const [id, job] of extractionJobs) {
      if (!job.autoRun || job.applied) continue;
      try {
        await extractionGuard(job)();
        await extractionState(id, job, { summary: true });
      } catch (error) { app.log.info({ event: 'extraction.recovery_skipped', jobId: id, code: error.code }, 'Extraction recovery awaits a valid current project'); }
    }
  });
  app.addHook("onClose", async () => { await systemAi.close?.(); await store.close?.(); });
  return app;
}
