import { ProjectKnowledge } from '../components/ProjectKnowledge';
import { ProjectSummary } from '../components/ProjectSummary';
import { DocumentPresence } from '../components/DocumentPresence';
import { ARTIFACT_DRAG_TYPE, memoryFolderChain, memoryFolderIncludes } from '../lib/memoryNavigation';
import { ProgramReferences } from "../components/ProgramReferences";
import { ensureProgramReferenceFolder } from "../../shared/workspace-templates.mjs";
import { ProjectMapHistory } from "../components/ProjectMapHistory";
import { MemoryWorkspace, ArtifactPermission } from "../components/MemoryWorkspace";
import { MemoryFolders } from "../components/MemoryFolders";
import { canEditSector, folderPath, folderSector, isProjectAdmin, PROJECT_TYPES } from "../../shared/project-organization.mjs";
import type { ProjectType } from "../../shared/project-organization.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Link2,
  LoaderCircle,
  Plus,
  Pencil,
  Search,
  FolderOpen,
  Trash2,
  Unlink2,
  UsersRound,
  X
} from "lucide-react";
import { ArtifactSourceFields } from "../components/ArtifactSourceFields";
import { ProjectTeamConfigurator } from "../components/ProjectTeamConfigurator";
import { API_ORIGIN, ApiError, useAuth } from "../lib/auth";
import { artifactHref, artifactIsStoredFile, artifactStatusLabel, formatArtifactSize } from "../lib/artifacts";
import { projectMemoryReadiness } from "../../shared/project-memory.mjs";
import { programModality, referenceProgram, REFERENCE_PROGRAMS } from "../lib/programs";
import type { MissionProject } from "../lib/projectStore";
import type { ArtifactKind, ArtifactScope, ConnectedArtifact, TeamMember, TeamRecord } from "../lib/team";
import type { Language } from "../lib/types";
import "../project-memory.css";
import "../project-workspace.css";

type Props = {
  language: Language;
  project: MissionProject;
  isDraft?: boolean;
  t: (path: string) => string;
  onLanguageChange: (language: Language) => void;
  onProjectChange: (project: MissionProject) => void;
  onContinue: () => Promise<void> | void;
  onRegenerate?: () => Promise<void>;
  onHome: () => void;
  onPersistProject: (project: MissionProject) => Promise<void>;
  onTeams: () => void;
  onManageTeam: () => void;
};

type DialogState =
  | { type: "program" }
  | { type: "team" }
  | { type: "artifact"; scope: ArtifactScope; artifact: ConnectedArtifact | null }
  | null;

type ArtifactFormat = "github" | "pdf" | "csv" | "sheet" | "doc" | "code" | "link";

function artifactFormat(artifact: ConnectedArtifact): ArtifactFormat {
  if (artifact.documentText !== undefined) return "pdf";
  if (artifact.kind === "repository" || /github\.com/iu.test(artifact.url)) return "github";
  const path = (artifact.fileName || artifact.url).toLocaleLowerCase("en-US").split(/[?#]/u)[0];
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".csv")) return "csv";
  if (/\.(xlsx?|ods)$/u.test(path)) return "sheet";
  if (/\.(docx?|odt|rtf)$/u.test(path)) return "doc";
  if (/\.(ino|c|cpp|h|ts|tsx|js|py)$/u.test(path)) return "code";
  return artifact.kind === "link" ? "link" : "doc";
}

function ArtifactIcon({ artifact }: { artifact: ConnectedArtifact }) {
  const format = artifactFormat(artifact);
  if (format === "github") return <span className="pm-format-icon github"><GitBranch aria-hidden="true" /><small>GIT</small></span>;
  if (format === "csv" || format === "sheet") return <span className="pm-format-icon sheet"><FileSpreadsheet aria-hidden="true" /><small>{format === "csv" ? "CSV" : "XLS"}</small></span>;
  if (format === "code") return <span className="pm-format-icon code"><FileCode2 aria-hidden="true" /><small>CODE</small></span>;
  if (format === "link") return <span className="pm-format-icon link"><Link2 aria-hidden="true" /></span>;
  return <span className={"pm-format-icon " + format}><FileText aria-hidden="true" /><small>{format === "pdf" ? "PDF" : "DOC"}</small></span>;
}

function MemoryDialog({ title, eyebrow, children, onClose, className = "" }: { title: string; eyebrow: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="pm-dialog-backdrop" role="presentation" onPointerDown={onClose}>
    <section className={`pm-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby="pm-dialog-title" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><span>{eyebrow}</span><h2 id="pm-dialog-title">{title}</h2></div><button type="button" onClick={onClose} aria-label="Fechar"><X aria-hidden="true" /></button></header>
      {children}
    </section>
  </div>;
}

function memoryTabFromHash(): "documents" | "overview" | "knowledge" | "settings" {
  const value = new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab');
  return value === 'summary' || value === 'overview' ? 'overview' : value === 'knowledge' || value === 'settings' ? value : 'documents';
}

export function StudySetupPage({ language, project, isDraft = false, onProjectChange, onContinue, onRegenerate, onTeams, onPersistProject }: Props) {
  const auth = useAuth();
  const [tab, setTab] = useState<"documents" | "overview" | "knowledge" | "settings">(() => memoryTabFromHash());
  useEffect(() => { const navigate = () => setTab(memoryTabFromHash()); window.addEventListener('hashchange', navigate); return () => window.removeEventListener('hashchange', navigate); }, []);
  const [movingArtifact, setMovingArtifact] = useState<ConnectedArtifact|null>(null);
  const [documentLimit, setDocumentLimit] = useState(60);
  const [query, setQuery] = useState("");
  const [expandedMemory, setExpandedMemory] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState("all");
  const admin = isProjectAdmin(project, auth.user);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [artifacts, setArtifacts] = useState<ConnectedArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [memoryLoadError, setMemoryLoadError] = useState("");
  const memoryLoadId = useRef(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [programToast, setProgramToast] = useState("");
  useEffect(() => { if (!programToast) return; const timer = window.setTimeout(() => setProgramToast(""), 4500); return () => window.clearTimeout(timer); }, [programToast]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [programSyncing, setProgramSyncing] = useState(false);

  const c = useMemo(() => language === "pt" ? {
    back: "Início",
    title: "MEMÓRIA DO PROJETO",
    projectName: "NOME DO PROJETO",
    projectPlaceholder: "Ex.: Missão Aurora",
    referenceProgram: "PROGRAMA DE REFERÊNCIA",
    programHint: "Selecione um programa e vincule os documentos oficiais à memória do projeto.",
    chooseProgram: "Selecione um programa",
    chooseReference: "Escolher programa",
    programDetails: "Ver detalhes",
    programEmptyTitle: "Escolha um programa de referência",
    programEmptyHint: "Os documentos de referência ficam organizados junto aos artefatos.",
    programDetailsHint: "Vincule um programa se ele definir regras para o projeto; caso contrário, mantenha projeto independente.",
    available: "Disponível",
    soon: "em breve",
    modality: "Modalidade",
    category: "Categoria",
    officialDocs: "Documentos oficiais",
    officialSource: "Links do programa · consulte a versão vigente",
    importingProgram: "Atualizando competição e categoria...",
    importedProgram: "Seleção da competição atualizada.",
    milestone: "Próximo marco",
    deadline: "Prazo oficial",
    team: "EQUIPE DO PROJETO",
    chooseTeam: "Selecione uma equipe",
    noTeam: "Você ainda não participa de nenhuma equipe.",
    teamsArea: "Abrir equipes",
    configureTeam: "Equipe do projeto",
    teamEmptyTitle: "Conecte uma equipe ao projeto",
    teamEmptyHint: "Depois, escolha os participantes e atribua suas funções.",
    participating: "Participantes",
    people: "pessoas",
    viewTeam: "Lista e hierarquia",
    chooseMembers: "Escolher membros",
    addMember: "Nova pessoa",
    projectStructure: "Cargos e setores",
    structureTitle: "Estrutura deste projeto",
    structureHint: "Cargos e setores pertencem somente a este projeto. Os dados acadêmicos continuam no perfil de cada pessoa.",
    roles: "CARGOS",
    sectors: "SETORES",
    addRole: "Adicionar cargo",
    addSector: "Adicionar setor",
    newRole: "Novo cargo",
    newSector: "Novo setor",
    roleInUse: "Este cargo está atribuído e não pode ser removido.",
    role: "Função",
    sector: "Setor",
    noSector: "Sem setor",
    artifacts: "ARTEFATOS",
    selectArtifacts: "Selecionar",
    addArtifact: "Adicionar",
    noArtifacts: "Nenhum artefato vinculado.",
    unlink: "Remover desta memória",
    edit: "Editar",
    delete: "Excluir artefato do projeto",
    open: "Abrir",
    continue: "Abrir concepção",
    createAndContinue: "Criar projeto e começar",
    missing: "Para continuar, complete:",
    missingName: "nome do projeto",
    missingProgram: "programa, modalidade e categoria",
    missingTeam: "equipe do projeto",
    missingMembers: "ao menos uma pessoa",
    missingReadable: "um documento de texto ou PDF que o Norte consiga ler",
    independentProgram: "Projeto de engenharia independente",
    independentHint: "Este projeto não participa de uma competição.",
    markIndependent: "Sem programa de referência",
    chooseProgramInstead: "Escolher um programa",
    loading: "Carregando memória",
    loadError: "Não foi possível carregar a memória do projeto.",
    retryMemory: "Tentar carregar novamente",
    memoryUnavailable: "Aguardando carregar a memória",
    saved: "Alteração salva.",
    unlinked: "O artefato saiu desta memória, mas continua guardado na equipe.",
    chooseProjectMembers: "Membros deste projeto",
    memberDialogHint: "Marque somente quem participa deste projeto. A equipe completa não será alterada.",
    inviteTitle: "Adicionar pessoa à equipe",
    personName: "Nome",
    personEmail: "E-mail",
    inviteHint: "A pessoa poderá criar a conta normalmente com este e-mail; não é necessário código.",
    teamReference: "Da equipe",
    projectReference: "Do projeto",
    newProjectArtifact: "Novo artefato do projeto",
    editArtifact: "Editar artefato",
    kind: "Tipo",
    artifactName: "Nome",
    url: "Link ou caminho",
    description: "Descrição",
    save: "Salvar",
    remove: "Remover",
    cancel: "Cancelar",
    deleteConfirm: "Excluir este artefato do projeto? Esta ação remove a referência do acervo do projeto.",
    sourceKinds: { document: "Documento", repository: "Repositório GitHub", dataset: "CSV ou planilha", link: "Link" }
  } : {
    back: "Home",
    title: "PROJECT MEMORY",
    projectName: "PROJECT NAME",
    projectPlaceholder: "E.g. Aurora Mission",
    referenceProgram: "REFERENCE PROGRAM",
    programHint: "Select a program and link its official documents to project memory.",
    chooseProgram: "Select a program",
    chooseReference: "Choose program",
    programDetails: "View details",
    programEmptyTitle: "Choose a reference program",
    programEmptyHint: "Reference documents are organized alongside project artifacts.",
    programDetailsHint: "Link a program if it defines project rules; otherwise, keep an independent project.",
    available: "Available",
    soon: "coming soon",
    modality: "Modality",
    category: "Category",
    officialDocs: "Official documents",
    officialSource: "Program links · check the current edition",
    importingProgram: "Updating competition and category...",
    importedProgram: "Competition selection updated.",
    milestone: "Next milestone",
    deadline: "Official deadline",
    team: "PROJECT TEAM",
    chooseTeam: "Select a team",
    noTeam: "You are not part of a team yet.",
    teamsArea: "Open teams",
    configureTeam: "Project team",
    teamEmptyTitle: "Connect a team to the project",
    teamEmptyHint: "Then choose participants and assign their roles.",
    participating: "Participants",
    people: "people",
    viewTeam: "List and hierarchy",
    chooseMembers: "Choose members",
    addMember: "New person",
    projectStructure: "Roles and sectors",
    structureTitle: "Project structure",
    structureHint: "Roles and sectors belong only to this project. Academic information remains in each person's profile.",
    roles: "ROLES",
    sectors: "SECTORS",
    addRole: "Add role",
    addSector: "Add sector",
    newRole: "New role",
    newSector: "New sector",
    roleInUse: "This role is assigned and cannot be removed.",
    role: "Role",
    sector: "Sector",
    noSector: "No sector",
    artifacts: "ARTIFACTS",
    selectArtifacts: "Select",
    addArtifact: "Add",
    noArtifacts: "No artifacts linked.",
    unlink: "Remove from this memory",
    edit: "Edit",
    delete: "Delete project artifact",
    open: "Open",
    continue: "Open conception",
    createAndContinue: "Create project and start",
    missing: "To continue, complete:",
    missingName: "project name",
    missingProgram: "program, modality, and category",
    missingTeam: "project team",
    missingMembers: "at least one person",
    missingReadable: "a text or PDF document Norte can read",
    independentProgram: "Independent engineering project",
    independentHint: "This project is not part of a competition.",
    markIndependent: "No reference program",
    chooseProgramInstead: "Choose a program",
    loading: "Loading memory",
    loadError: "Project memory could not be loaded.",
    retryMemory: "Retry loading memory",
    memoryUnavailable: "Waiting for project memory",
    saved: "Change saved.",
    unlinked: "The artifact was removed from this memory but remains in the team library.",
    chooseProjectMembers: "Project members",
    memberDialogHint: "Select only those participating in this project. The full team will not be changed.",
    inviteTitle: "Add a person to the team",
    personName: "Name",
    personEmail: "Email",
    inviteHint: "The person can create an account normally with this email; no code is needed.",
    teamReference: "From team",
    projectReference: "From project",
    newProjectArtifact: "New project artifact",
    editArtifact: "Edit artifact",
    kind: "Type",
    artifactName: "Name",
    url: "Link or path",
    description: "Description",
    save: "Save",
    remove: "Remove",
    cancel: "Cancel",
    deleteConfirm: "Delete this project artifact? This removes the reference from the project library.",
    sourceKinds: { document: "Document", repository: "GitHub repository", dataset: "CSV or spreadsheet", link: "Link" }
  }, [language]);

  const loadMemory = useCallback(async () => {
    const loadId = ++memoryLoadId.current;
    setLoading(true);
    setMemoryLoadError("");
    try {
      const [teamResponse, memberResponse, artifactResponse] = await Promise.all([
        auth.api<{ teams: TeamRecord[] }>("/teams"),
        auth.api<{ members: TeamMember[] }>("/team/members"),
        auth.api<{ artifacts: ConnectedArtifact[] }>("/artifacts")
      ]);
      if (loadId !== memoryLoadId.current) return;
      setTeams(teamResponse.teams);
      setMembers(memberResponse.members);
      setArtifacts(artifactResponse.artifacts.filter((artifact) => !artifact.official));
    } catch (reason) {
      if (loadId === memoryLoadId.current) setMemoryLoadError(reason instanceof ApiError ? reason.message : c.loadError);
    } finally {
      if (loadId === memoryLoadId.current) setLoading(false);
    }
  }, [auth.api, c.loadError]);

  useEffect(() => { void loadMemory(); return () => { memoryLoadId.current++; }; }, [loadMemory]);

  const program = referenceProgram(project.context.programId);
  const modality = programModality(program, project.context.modalityId);
  const associatedTeams = teams.filter((team) => team.membership === "member" || team.memberIds.includes(auth.user?.memberId || ""));
  const selectedTeam = associatedTeams.find((team) => team.id === project.context.teamId) ?? null;
  const availableTeamArtifacts = useMemo(() => selectedTeam ? selectedTeam.artifactIds.map((id) => artifacts.find((artifact) => artifact.id === id)).filter((artifact): artifact is ConnectedArtifact => Boolean(artifact)) : [], [artifacts, selectedTeam]);
  const linkedTeamArtifacts = availableTeamArtifacts.filter((artifact) => project.context.teamArtifactIds.includes(artifact.id)).map(artifact => ({ ...artifact, folderId: project.context.teamArtifactFolders?.[artifact.id] || null }));
  const linkedProjectArtifacts = artifacts.filter((artifact) => artifact.scope === "project" && (artifact.ownerId === project.id || project.context.projectArtifactIds.includes(artifact.id)));

  function updateProject(next: Partial<MissionProject>, contextPatch?: Partial<MissionProject["context"]>) {
    onProjectChange({
      ...project,
      ...next,
      context: contextPatch ? { ...project.context, ...contextPatch } : project.context
    });
  }

  function selectProgram(programId: string) {
    const nextProgram = referenceProgram(programId);
    const nextModality = nextProgram?.modalities[0] ?? null;
    const nextCategory = nextModality?.categories.find((item) => item.id === "n3") ?? nextModality?.categories[0] ?? null;
    updateProject({}, {
      configured: false,
      referenceProgram: null,
      programId: nextProgram?.id ?? null,
      modalityId: nextModality?.id ?? null,
      categoryId: nextCategory?.id ?? null
    });
  }

  function selectIndependent() {
    updateProject({}, { configured: false, referenceProgram: "independent", programId: null, modalityId: null, categoryId: null });
  }

  function selectModality(modalityId: string) {
    const nextModality = program?.modalities.find((item) => item.id === modalityId) ?? null;
    updateProject({}, { configured: false, modalityId: nextModality?.id ?? null, categoryId: nextModality?.categories[0]?.id ?? null });
  }

  function selectTeam(teamId: string) {
    const team = associatedTeams.find((item) => item.id === teamId) ?? null;
    if (!team) {
      updateProject({}, { configured: false, teamId: null, teamName: "", teamArtifactIds: [], teamArtifactFolders: {}, assignments: [] });
      return;
    }
    let assignments = project.context.assignments.filter((assignment) => team.memberIds.includes(assignment.memberId));
    if (assignments.length === 0) {
      const preferredMemberId = team.memberIds.includes(auth.user?.memberId || "") ? auth.user?.memberId : team.memberIds[0];
      if (preferredMemberId) assignments = [{ memberId: preferredMemberId, roleId: "captain", sectorId: "" }];
    }
    updateProject({}, { configured: false, teamId: team.id, teamName: team.name, teamArtifactIds: [], teamArtifactFolders: {}, programArtifactIds: (project.context.programArtifactIds || []).filter(id => project.context.projectArtifactIds.includes(id)), assignments });
  }

  function toggleTeamArtifact(artifactId: string) {
    const placements = { ...project.context.teamArtifactFolders };
    delete placements[artifactId];
    const linked = project.context.teamArtifactIds.includes(artifactId);
    updateProject({}, { programArtifactIds: (project.context.programArtifactIds || []).filter(id => id !== artifactId), teamArtifactFolders: placements, teamArtifactIds: linked ? project.context.teamArtifactIds.filter((id) => id !== artifactId) : [...project.context.teamArtifactIds, artifactId] });
    if (linked) setFeedback(c.unlinked);
  }

  async function finishProgramSetup() {
    setProgramSyncing(true); setFeedback("");
    try { const next = program ? ensureProgramReferenceFolder(project, language) : project; await onPersistProject(next); setDialog(null); if (program) { setTab('documents'); setSelectedFolder(next.context.programFolderId!); } setProgramToast(c.importedProgram); }
    catch (reason) { setFeedback(reason instanceof Error ? reason.message : c.loadError); }
    finally { setProgramSyncing(false); }
  }

  async function saveArtifact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.type !== "artifact") return;
    const data = new FormData(event.currentTarget);
    const current = dialog.artifact;
    const ownerId = dialog.scope === "team" ? selectedTeam?.id : project.id;
    if (!ownerId) return;
    const payload: Record<string, unknown> = {
      folderId: dialog.scope === "project" ? data.get("folderId") || null : null,
      entityId: data.get("entityId") || null,
      ...(data.has("documentText") ? { documentText: String(data.get("documentText")) } : {}),
      kind: String(data.get("kind") || "document") as ArtifactKind,
      sourceRole: data.get("sourceRole") === "supporting_datasheet" ? "supporting_datasheet" : "project_context",
      label: String(data.get("label") || ""),
      ...(data.has("documentText") ? {} : { url: String(data.get("url") || "") }),
      fileName: String(data.get("fileName") || ""),
      mimeType: String(data.get("mimeType") || ""),
      size: Number(data.get("size") || 0),
      description: String(data.get("description") || ""),
      tags: [],
      scope: dialog.scope,
      ownerId
    };
    // Editing a stored file without replacing it submits no url: the server
    // keeps the bytes it already holds. A new artifact always needs a source.
    const keepsStoredContent = Boolean(current && !payload.url && current.contentPath);
    if (keepsStoredContent) Reflect.deleteProperty(payload, "url");
    else if (!payload.url && !payload.documentText) {
      setFeedback(language === "pt" ? "Adicione um link ou escolha um arquivo." : "Add a link or choose a file.");
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      let artifactId = current?.id || "";
      if (current) {
        await auth.api("/artifacts/" + current.id, { method: "PATCH", body: JSON.stringify({ ...payload, expectedRevision: current.revision || 0 }) });

      } else {
        const response = await auth.api<{ artifact: ConnectedArtifact }>("/artifacts", { method: "POST", body: JSON.stringify(payload) });
        artifactId = response.artifact.id;
      }
      if (dialog.scope === "team" && artifactId && !project.context.teamArtifactIds.includes(artifactId)) {
        updateProject({}, { teamArtifactIds: [...project.context.teamArtifactIds, artifactId] });
      }
      setDialog(null);
      const refreshed = await auth.api<{ project: MissionProject }>("/projects/" + project.id);
      onProjectChange(refreshed.project);
      await loadMemory();
      setFeedback(c.saved);
    } catch (reason) {
      setFeedback(reason instanceof ApiError ? reason.message : c.loadError);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProjectArtifact(artifact: ConnectedArtifact, fromReader = false) {
    if (!window.confirm(c.deleteConfirm)) return false;
    setBusy(true);
    try {
      await auth.api("/artifacts/" + artifact.id, { method: "DELETE" });

      const refreshed = await auth.api<{ project: MissionProject }>("/projects/" + project.id);
      onProjectChange(refreshed.project);
      await loadMemory();
      return true;
    } catch (reason) {
      setFeedback(reason instanceof ApiError ? reason.message : c.loadError);
      if (fromReader) throw reason;
      return false;
    } finally {
      setBusy(false);
    }
  }

  // One readiness rule, shared with the server, so the page can never promise
  // memory that /system-ai/generate will immediately reject.
  const readiness = projectMemoryReadiness(project, artifacts);
  const canGenerate = !loading && !memoryLoadError && readiness.ready;
  const canContinue = Boolean(project.name.trim() && project.context.teamId);

  const staleMap = Boolean(project.engineeringSystem && (project.engineeringSystem.generatedFromRevision ?? project.systemGeneratedFromRevision ?? 0) !== (project.memoryRevision || 0));
  async function regenerateMap() {
    if (!onRegenerate || !canGenerate) return;
    setBusy(true); setFeedback("");
    try { await onRegenerate(); } catch (reason) { setFeedback(reason instanceof Error ? reason.message : c.loadError); } finally { setBusy(false); }
  }

  async function continueToConception() {
    if (!canContinue) return;
    updateProject({}, { configured: true });
    setBusy(true);
    setFeedback("");
    try {
      await onContinue();
    } catch (reason) {
      setFeedback(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : c.loadError);
    } finally {
      setBusy(false);
    }
  }

  const documents = [...linkedTeamArtifacts, ...linkedProjectArtifacts];
  const childFolders = (project.context.folders || []).filter(folder => folder.parentId === selectedFolder);
  const visibleDocuments = documents.filter(artifact => memoryFolderIncludes(project, artifact, selectedFolder) && `${artifact.label} ${artifact.fileName || ""} ${folderPath(project, artifact.folderId)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function openDocument(id: string) { const artifact = documents.find(item => item.id === id); if (artifact && !memoryFolderIncludes(project, artifact, selectedFolder)) setSelectedFolder(artifact.folderId || ''); setSelectedArtifact(id); setExpandedMemory(true); }
  async function moveDocument(id: string, folderId: string) {
    const artifact = artifacts.find(item => item.id === id); if (!artifact) throw new Error(language === 'pt' ? 'Documento indisponível.' : 'Document unavailable.');
    await auth.api(`/artifacts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ folderId: folderId || null, expectedRevision: artifact.revision || 0 }) });
    const refreshed = await auth.api<{ project: MissionProject }>(`/projects/${project.id}`); onProjectChange(refreshed.project); await loadMemory();
    if (expandedMemory && selectedArtifact === id) setSelectedFolder(folderId || '');
    setFeedback(language === 'pt' ? 'Documento movido.' : 'Document moved.');
  }

  function ArtifactCard({ artifact, scope }: { artifact: ConnectedArtifact; scope: ArtifactScope }) {
    const canEdit = scope === "project" && (artifact.canEdit ?? canEditSector(project, auth.user, folderSector(project, artifact.folderId)));
    const stored = artifactIsStoredFile(artifact);
    const pdf = artifact.documentText !== undefined || artifact.mimeType === "application/pdf";
    const href = artifact.documentText !== undefined ? `${API_ORIGIN}/api/artifacts/${artifact.id}/pdf` : artifactHref(artifact);
    const status = artifactStatusLabel(artifact, language);
    const size = formatArtifactSize(artifact.size);
    return <article className="pm-artifact-card" draggable={Boolean(canEdit)} onDragStart={event => { event.dataTransfer.setData(ARTIFACT_DRAG_TYPE, artifact.id); event.dataTransfer.effectAllowed = 'move'; }}>
      <a onClick={event => { event.preventDefault(); openDocument(artifact.id); }} href={href} target={pdf || !stored ? "_blank" : undefined} rel={stored ? undefined : "noreferrer"} download={stored && !pdf ? artifact.fileName || artifact.label : undefined} aria-label={`${c.open}: ${artifact.label}`}>
        <ArtifactIcon artifact={artifact} />
        <div>
          <small>{folderPath(project, artifact.folderId) || (scope === "team" ? c.teamReference : c.projectReference)}</small>
          <strong>{artifact.label}</strong>
          <ArtifactPermission artifact={{ ...artifact, canEdit }} language={language} />
          <span>{artifact.description || artifact.fileName || (stored ? "" : artifact.url)}</span>
          <em className={status.usable ? "pm-artifact-status usable" : "pm-artifact-status blocked"}>{size && `${size} · `}{status.text}</em>
        </div>
        <ExternalLink aria-hidden="true" />
      </a>
      <div className="pm-artifact-actions">
        {scope === "team" && canEditSector(project, auth.user, folderSector(project, artifact.folderId)) && <select aria-label={language === "pt" ? `Pasta da referência ${artifact.label}` : `Reference folder ${artifact.label}`} value={artifact.folderId || ""} onChange={async event => {
          const placements = { ...project.context.teamArtifactFolders };
          if (event.target.value) placements[artifact.id] = event.target.value; else delete placements[artifact.id];
          try { await onPersistProject({ ...project, context: { ...project.context, teamArtifactFolders: placements } }); } catch (reason) { setFeedback(reason instanceof Error ? reason.message : c.loadError); }
        }}><option value="" disabled={!admin}>{language === "pt" ? "Sem pasta" : "Unfiled"}</option>{[...project.context.sectors, ...(project.context.folders || [])].filter(f => canEditSector(project, auth.user, folderSector(project, f.id))).map(f => <option value={f.id} key={f.id}>{folderPath(project, f.id)}</option>)}</select>}
        {pdf && <a href={`${href}?download=1`} download>{language === "pt" ? "Baixar PDF" : "Download PDF"}</a>}
        {canEdit && <button type="button" title={language === 'pt' ? 'Mover documento' : 'Move document'} aria-label={`${language === 'pt' ? 'Mover' : 'Move'}: ${artifact.label}`} onClick={() => { setFeedback(''); setMovingArtifact(artifact); }}><FolderOpen size={16} /></button>}
        {canEdit && <button type="button" title={c.edit} aria-label={c.edit} onClick={() => setDialog({ type: "artifact", scope, artifact })}><Pencil aria-hidden="true" /></button>}
        {scope === "team" && admin ? <button type="button" title={c.unlink} aria-label={c.unlink} onClick={() => toggleTeamArtifact(artifact.id)}><Unlink2 aria-hidden="true" /></button> : canEdit && scope === "project" ? <button type="button" title={c.delete} aria-label={c.delete} onClick={() => void deleteProjectArtifact(artifact)}><Trash2 aria-hidden="true" /></button> : null}
      </div>
    </article>;
  }

  return <div className="pm-shell pm-organized">
    <main className="pm-main" inert={expandedMemory || Boolean(dialog) || Boolean(movingArtifact)} aria-hidden={expandedMemory || Boolean(dialog) || Boolean(movingArtifact)}>


      <div className="pm-workspace">
        {memoryLoadError && <div className="pm-memory-error" role="alert">
          <span>{memoryLoadError}</span>
          <button type="button" onClick={() => void loadMemory()} disabled={loading}>{c.retryMemory}</button>
        </div>}
        <header className="pm-heading">
          <div><span className="pm-section-label">{project.name}</span><h1>{language === "pt" ? "Memória do projeto" : "Project memory"}</h1><p>{language === "pt" ? "Documentos, decisões e fontes da engenharia." : "Engineering documents, decisions and sources."}</p></div>
          <div className="pm-heading-actions"><button className="pm-open-conception" type="button" onClick={() => void continueToConception()} disabled={!canContinue || busy}>{isDraft ? c.createAndContinue : c.continue}<ArrowRight aria-hidden="true" /></button></div>
        </header>
        <nav className="pm-section-tabs" aria-label={language === "pt" ? "Áreas da memória" : "Memory areas"}>
          {([['documents', language === 'pt' ? 'Documentos' : 'Documents'], ['overview', language === 'pt' ? 'Resumo' : 'Overview'], ['knowledge', language === 'pt' ? 'Conhecimento' : 'Knowledge'], ['settings', language === 'pt' ? 'Configuração' : 'Settings']] as const).map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}{key === 'documents' && <span>{documents.length}</span>}</button>)}
        </nav>

        {staleMap && tab === "documents" && <p role="status" className="pm-map-update-notice">{language === "pt" ? "Há documentos novos ou alterados. Gere uma proposta para revisar as mudanças no mapa atual." : "Documents have changed. Generate a proposal to review changes to the current map."}</p>}
        {programToast && <div className="pm-program-toast" role="status">{programToast}<button type="button" onClick={() => setProgramToast("")} aria-label={language === "pt" ? "Fechar notificação" : "Dismiss notification"}><X /></button></div>}
        {feedback && <div className="pm-feedback" role="status">{feedback}<button type="button" onClick={() => setFeedback("")} aria-label="Fechar"><X aria-hidden="true" /></button></div>}

        {tab === "overview" && <><ProjectSummary project={project} language={language} onSave={onPersistProject} /><div className="pm-overview-links"><span>{selectedTeam?.name || project.context.teamName}</span><button type="button" onClick={() => setTab('documents')}>{documents.length} {language === 'pt' ? 'documentos' : 'documents'}</button><button type="button" onClick={() => setTab('knowledge')}>{language === 'pt' ? 'Revisar conhecimento' : 'Review knowledge'}</button>{admin && project.engineeringSystem && <ProjectMapHistory projectId={project.id} model={project.engineeringSystem} language={language} />}</div></>}
        {tab === "knowledge" && <ProjectKnowledge project={project} artifacts={documents} language={language} onSource={id => { setSelectedFolder('all'); openDocument(id); }} onDocuments={() => setTab('documents')} />}

        {tab === "settings" && <div className="pm-settings-layout">
          <section className="pm-settings-card"><h2>{language === 'pt' ? 'Informações do projeto' : 'Project information'}</h2><label className="workspace-field"><span>{c.projectName}</span><input id="project-memory-name" name="projectName" disabled={!admin} value={project.name} onChange={event => updateProject({ name: event.target.value })} placeholder={c.projectPlaceholder} maxLength={120} /></label>
            <label className="workspace-field"><span>{language === 'pt' ? 'Tipo de projeto' : 'Project type'}</span><select aria-label={language === 'pt' ? 'Tipo de projeto' : 'Project type'} disabled={!admin} value={project.projectType || 'product'} onChange={event => updateProject({ projectType: event.target.value as ProjectType })}>{Object.entries(PROJECT_TYPES).map(([key, type]) => <option key={key} value={key}>{type[language]}</option>)}</select></label>
            <label className="workspace-field"><span>{language === 'pt' ? 'Objetivo do projeto' : 'Project objective'}</span><textarea disabled={!admin} maxLength={5000} rows={3} value={project.setup.statement} onChange={event => updateProject({ setup: { ...project.setup, statement: event.target.value } })} placeholder={language === 'pt' ? 'Qual problema este projeto resolve?' : 'What problem does this project solve?'} /></label>
          </section>
          <section className="pm-settings-card"><h2>{language === 'pt' ? 'Organização e acessos' : 'Organization and access'}</h2><p>{language === 'pt' ? 'Setores organizam documentos e responsabilidades. O responsável pelo projeto administra tudo; gerentes organizam suas pastas e delegam edição no próprio setor.' : 'Sectors organize documents and responsibilities. The project lead manages everything; managers organize folders and delegate editing within their sector.'}</p><button type="button" onClick={() => setDialog({ type: 'team' })}><UsersRound size={16} />{language === 'pt' ? 'Equipe e acessos' : 'Team and access'}</button>
          </section>
          <section className="pm-settings-card pm-program-setting"><div><h2>{language === 'pt' ? 'Programa de referência' : 'Reference program'}</h2><p>{program?.name[language] || (language === 'pt' ? 'Projeto independente' : 'Independent project')}{modality ? ` · ${modality.label[language]}` : ''}</p></div><button type="button" disabled={!admin} onClick={() => setDialog({ type: 'program' })}>{language === 'pt' ? 'Alterar' : 'Change'}</button></section>
        </div>}

        {tab === "documents" && <section className="pm-artifacts-board">
          <section className="pm-band pm-artifact-band">
            <header><div className="pm-folder-location"><FolderOpen size={18} /><nav className="pm-folder-breadcrumb" aria-label={language === 'pt' ? 'Local atual' : 'Current location'}><button type="button" onClick={() => setSelectedFolder('all')}>{language === 'pt' ? 'Documentos' : 'Documents'}</button>{memoryFolderChain(project, selectedFolder).map(folder => <span key={folder.id}><ChevronRight size={12} /><button type="button" onClick={() => setSelectedFolder(folder.id)}>{folder.name}</button></span>)}</nav></div><div className="pm-band-actions"><button type="button" title={language === "pt" ? "Selecione uma pasta de um setor em que você pode editar." : "Select a folder in a sector you can edit."} disabled={!canEditSector(project, auth.user, folderSector(project, selectedFolder === "all" ? null : selectedFolder))} onClick={() => setDialog({ type: "artifact", scope: "project", artifact: null })}><Plus aria-hidden="true" />{c.addArtifact}</button></div></header>
            <ProgramReferences project={project} artifacts={documents} language={language} programName={program?.shortName} onSave={onPersistProject} onFolder={setSelectedFolder} onUpload={() => setDialog({ type: "artifact", scope: "project", artifact: null })} />
            {admin && onRegenerate && <div className="pm-extraction-action"><div><strong>{language === 'pt' ? 'Mapa a partir dos documentos' : 'Map from documents'}</strong><p>{canGenerate ? (language === 'pt' ? 'A IA propõe uma estrutura com referências. Revise antes de aplicar.' : 'AI proposes a structure with source references. Review before applying.') : (language === 'pt' ? 'Adicione ao menos um PDF ou texto legível quando quiser gerar o mapa.' : 'Add at least one readable PDF or text when you want to generate a map.')}</p></div><button className="pm-update-map" type="button" onClick={() => void regenerateMap()} disabled={!canGenerate || busy}>{language === 'pt' ? (project.engineeringSystem ? 'Atualizar mapa' : 'Gerar mapa') : (project.engineeringSystem ? 'Update map' : 'Generate map')}</button></div>}
            <div className="memory-library"><MemoryFolders project={project} language={language} artifacts={documents} selected={selectedFolder} activeArtifactId={selectedArtifact} onOpenArtifact={openDocument} onSelect={setSelectedFolder} onSave={onPersistProject} onMove={moveDocument} /><div className="pm-document-list"><label className="pm-document-search"><Search size={16} /><input type="search" aria-label={language === 'pt' ? 'Buscar documentos' : 'Search documents'} value={query} onChange={event => { setQuery(event.target.value); setDocumentLimit(60); }} placeholder={language === 'pt' ? 'Buscar por nome de documento' : 'Search document names'} /></label><div className="pm-artifact-grid">{!query && childFolders.map(folder => <button type="button" key={folder.id} className="pm-folder-entry" onClick={() => setSelectedFolder(folder.id)}><FolderOpen size={18} /><span>{folder.name}</span><ChevronRight size={16} /></button>)}{visibleDocuments.slice(0, documentLimit).map(artifact => <ArtifactCard artifact={artifact} scope={artifact.scope === 'team' ? 'team' : 'project'} key={artifact.id} />)}{visibleDocuments.length > documentLimit && <button className="pm-load-documents" type="button" onClick={() => setDocumentLimit(limit => limit + 60)}>{language === 'pt' ? 'Mostrar mais documentos' : 'Show more documents'} ({visibleDocuments.length - documentLimit})</button>}{!visibleDocuments.length && (Boolean(query) || !childFolders.length) && <div className="pm-documents-empty"><FileText size={28} /><h3>{query ? (language === 'pt' ? 'Nenhum resultado' : 'No results') : (language === 'pt' ? 'Seus documentos começam aqui' : 'Your documents start here')}</h3><p>{query ? (language === 'pt' ? 'Tente outro nome ou selecione Todos os documentos.' : 'Try another name or select All documents.') : (language === 'pt' ? 'Comece pela visão geral da missão ou um documento de requisitos: eles dão contexto ao mapa. Você também pode começar sem arquivos.' : 'Start with the mission overview or a requirements document to give the map context. You can also start without files.')}</p>{!query && <div className="pm-empty-actions"><button type="button" disabled={!canEditSector(project, auth.user, folderSector(project, selectedFolder === 'all' ? null : selectedFolder))} onClick={() => setDialog({ type: 'artifact', scope: 'project', artifact: null })}>{language === 'pt' ? 'Adicionar documento inicial' : 'Add first document'}</button><button type="button" onClick={() => void continueToConception()}>{language === 'pt' ? 'Começar concepção manual' : 'Start conception manually'}</button></div>}</div>}</div></div></div>


          </section>
        </section>}

      </div>
    </main>

    {expandedMemory && !dialog && !movingArtifact && <MemoryWorkspace project={project} artifacts={documents} language={language} selectedId={selectedArtifact} onSelect={setSelectedArtifact} folderId={selectedFolder} onFolder={setSelectedFolder} onSave={onPersistProject} onMove={moveDocument} onRequestMove={setMovingArtifact} onDelete={async artifact => { const removed = await deleteProjectArtifact(artifact, true); if (removed) { const remaining = documents.filter(item => item.id !== artifact.id), next = remaining.find(item => memoryFolderIncludes(project, item, selectedFolder)) || remaining[0]; if (next) openDocument(next.id); else setSelectedArtifact(null); } }} onEdit={artifact => { setDialog({ type: "artifact", scope: "project", artifact }); }} onClose={() => setExpandedMemory(false)} />}
    {movingArtifact && <MemoryDialog title={language === 'pt' ? 'Mover documento' : 'Move document'} eyebrow={movingArtifact.label} onClose={() => setMovingArtifact(null)}><form className="pm-dialog-form" onSubmit={async event => { event.preventDefault(); const folderId = String(new FormData(event.currentTarget).get('folderId') || ''); setBusy(true); setFeedback(''); try { await moveDocument(movingArtifact.id, folderId); setMovingArtifact(null); } catch (reason) { setFeedback(reason instanceof Error ? reason.message : c.loadError); } finally { setBusy(false); } }}>{feedback && <p role="alert">{feedback}</p>}<label>{language === 'pt' ? 'Pasta de destino' : 'Destination folder'}<select name="folderId" defaultValue={movingArtifact.folderId || ''}><option value="" disabled={!admin}>{language === 'pt' ? 'Sem pasta' : 'Unfiled'}</option>{[...project.context.sectors, ...(project.context.folders || [])].filter(folder => canEditSector(project, auth.user, folderSector(project, folder.id))).map(folder => <option value={folder.id} key={folder.id}>{folderPath(project, folder.id)}</option>)}</select></label><footer><button type="button" onClick={() => setMovingArtifact(null)}>{c.cancel}</button><button className="primary" type="submit" disabled={busy}>{language === 'pt' ? 'Mover' : 'Move'}</button></footer></form></MemoryDialog>}
    {dialog?.type === "program" && <MemoryDialog eyebrow={c.referenceProgram} title={program ? c.programDetails : c.chooseReference} onClose={() => setDialog(null)}>
      <div className="pm-dialog-copy">{c.programDetailsHint}</div>
      {feedback && <p role="alert">{feedback}</p>}
      <label className="pm-program-select">{language === 'pt' ? 'Programa (opcional)' : 'Program (optional)'}<select aria-label={language === 'pt' ? 'Programa (opcional)' : 'Program (optional)'} value={program?.id || 'independent'} onChange={event => event.target.value === 'independent' ? selectIndependent() : selectProgram(event.target.value)}><option value="independent">{language === 'pt' ? 'Projeto independente' : 'Independent project'}</option>{REFERENCE_PROGRAMS.filter(item => item.available).map(item => <option key={item.id} value={item.id}>{item.name[language]}</option>)}</select></label>
      {program && <div className="pm-program-detail">

        <div className="pm-program-controls"><label><span>{c.modality}</span><select value={project.context.modalityId || ""} onChange={(event) => selectModality(event.target.value)}>{program.modalities.map((item) => <option value={item.id} key={item.id}>{item.label[language]}</option>)}</select></label>{Boolean(modality?.categories.length) && <label><span>{c.category}</span><select value={project.context.categoryId || ""} onChange={(event) => updateProject({}, { configured: false, categoryId: event.target.value || null })}><option value="">{language === 'pt' ? 'Decidir depois' : 'Decide later'}</option>{modality?.categories.map((item) => <option value={item.id} key={item.id}>{item.label[language]}</option>)}</select></label>}</div>
        {modality && <details className="pm-official-library"><summary>{language === "pt" ? "Links oficiais do programa" : "Official program links"}</summary><h3>{c.officialDocs}<span>{c.officialSource}</span></h3><div>{modality.officialDocuments.map((document) => <a href={document.url} target="_blank" rel="noreferrer" key={document.id}><BookOpenCheck aria-hidden="true" /><span><small>{document.format.toUpperCase()}</small><strong>{document.label[language]}</strong></span><ExternalLink aria-hidden="true" /></a>)}{modality.milestone.date && <a href={modality.milestone.url} target="_blank" rel="noreferrer"><CalendarDays aria-hidden="true" /><span><small>{c.milestone}</small><strong>{modality.milestone.date} · {modality.milestone.label[language]}</strong></span><ExternalLink aria-hidden="true" /></a>}</div></details>}
      </div>}
      <footer><button className="primary" type="button" disabled={programSyncing} onClick={() => void finishProgramSetup()}><Check aria-hidden="true" />{c.save}</button></footer>
    </MemoryDialog>}

    {dialog?.type === "team" && <MemoryDialog className="pm-team-config-dialog" eyebrow={c.team} title={c.configureTeam} onClose={() => setDialog(null)}>
      <div className="pm-team-config">
        <label className="pm-dialog-field"><span>{c.team}</span><select disabled={!admin} value={project.context.teamId || ""} onChange={(event) => selectTeam(event.target.value)}><option value="">{associatedTeams.length ? c.chooseTeam : c.noTeam}</option>{associatedTeams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
        {!selectedTeam && <button className="pm-dialog-empty" type="button" onClick={() => { setDialog(null); onTeams(); }}><UsersRound aria-hidden="true" /><span><strong>{c.noTeam}</strong><small>{c.teamsArea}</small></span></button>}
        {selectedTeam && <ProjectTeamConfigurator key={selectedTeam.id} language={language} context={project.context} team={selectedTeam} members={members} project={project} onClose={() => setDialog(null)} onSave={async (patch) => { await onPersistProject({ ...project, context: { ...project.context, ...patch } }); setDialog(null); setFeedback(c.saved); }} />}
      </div>
    </MemoryDialog>}

    {dialog?.type === "artifact" && <MemoryDialog eyebrow={dialog.scope === "team" ? c.artifacts : c.artifacts} title={dialog.artifact ? c.editArtifact : c.newProjectArtifact} onClose={() => setDialog(null)}><form className="pm-dialog-form" onSubmit={(event) => void saveArtifact(event)}>{dialog.artifact && <DocumentPresence artifactId={dialog.artifact.id} mode="editing" language={language} />}{feedback && <p role="alert">{feedback}</p>}<label><span>{c.kind}</span><select name="kind" defaultValue={dialog.artifact?.kind || "document"}><option value="document">{c.sourceKinds.document}</option><option value="repository">{c.sourceKinds.repository}</option><option value="dataset">{c.sourceKinds.dataset}</option><option value="link">{c.sourceKinds.link}</option></select></label><label><span>{c.artifactName}</span><input name="label" defaultValue={dialog.artifact?.label || ""} required maxLength={140} autoFocus /></label>{dialog.scope === "project" && <><label className="pm-dialog-field"><span>{language === "pt" ? "Pasta" : "Folder"}</span><select name="folderId" defaultValue={dialog.artifact?.folderId || (selectedFolder === "all" ? "" : selectedFolder)}><option value="" disabled={!admin}>{language === "pt" ? "Sem pasta" : "Unfiled"}</option>{[...project.context.sectors, ...(project.context.folders || [])].filter(f => canEditSector(project, auth.user, folderSector(project, f.id))).map(f => <option value={f.id} key={f.id}>{folderPath(project, f.id)}</option>)}</select></label><label className="pm-dialog-field"><span>{language === "pt" ? "Objeto técnico relacionado" : "Related technical object"}</span><select name="entityId" defaultValue={dialog.artifact?.entityId || ""}><option value="">{language === "pt" ? "Nenhum" : "None"}</option>{project.engineeringSystem?.entities.map(e => <option key={e.id} value={e.id}>{e.kind} · {e.name}</option>)}</select></label></>}
      <ArtifactSourceFields allowDocument={!auth.isDemo} language={language} artifact={dialog.artifact} onError={setFeedback} /><label><span>{c.description}</span><textarea name="description" defaultValue={dialog.artifact?.description || ""} maxLength={500} rows={3} /></label><footer><button type="button" onClick={() => setDialog(null)}>{c.cancel}</button><button className="primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="pm-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}{c.save}</button></footer></form></MemoryDialog>}
  </div>;
}
