import type { Language } from "./types";

export type AccessRole = "owner_admin" | "captain" | "manager" | "member" | "advisor";
export type MemberStatus = "demo" | "invited" | "active";
export type ArtifactKind = "official" | "document" | "repository" | "dataset" | "link";
export type ArtifactScope = "team" | "project";

export type SessionUser = {
  testEnvironment?: boolean;
  demoAccount?: boolean;
  id: string;
  memberId: string;
  nickname?: string;
  login?: string;
  emailVerifiedAt?: string | null;
  name: string;
  initials: string;
  email: string;
  accessRole: AccessRole;
  institution: string;
  primaryArea?: string;
  avatarUrl?: string;
  profileComplete?: boolean;
};

export type TeamMember = {
  nickname?: string | null;
  id: string;
  accountId: string | null;
  displayName: string;
  email: string;
  missionRole: string;
  primaryArea: string;
  secondaryAreas: string[];
  institution: string;
  course: string;
  academicStage: string;
  skills: string[];
  availabilityHours: number;
  notes: string;
  accountStatus: MemberStatus;
  accessRole: AccessRole | null;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamRecord = {
  captainMemberId?: string | null;
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  artifactIds: string[];
  joinRequests: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  membership?: "member" | "requested" | "available";
  canManage?: boolean;
  memberCount?: number;
  artifactCount?: number;
  projectCount?: number;
};

export type ArtifactStatus = "parsed" | "pdf" | "not_parsed" | "metadata_only" | "unknown";
export type ArtifactSourceRole = "project_context" | "supporting_datasheet";

/** The server's verdict on whether this source can reach engineering extraction. */
export type ArtifactReadability = {
  status: ArtifactStatus;
  reason: string;
};

export type ConnectedArtifact = {
  revision?: number;
  sourceRole?: ArtifactSourceRole;
  folderId?: string | null;
  entityId?: string | null;
  documentText?: string;
  canEdit?: boolean;
  editReason?: string;
  id: string;
  kind: ArtifactKind;
  label: string;
  url: string;
  /** API path to the stored bytes, when Norte holds the file itself. */
  contentPath?: string;
  readability?: ArtifactReadability;
  description: string;
  tags: string[];
  official: boolean;
  createdBy: string | null;
  scope?: ArtifactScope;
  ownerId?: string | null;
  fileName?: string;
  mimeType?: string;
  size?: number;
  connectedAt: string;
  updatedAt: string;
};

export type DirectoryMember = {
  id: string;
  displayName: string;
  institution: string;
  course: string;
  avatarUrl?: string;
  presence: "online" | "recent" | "offline";
};

export type ProjectSummary = {
  id: string;
  name: string;
  projectType?: string | null;
  programId: string | null;
  teamId: string | null;
  updatedAt: string;
  memberCount: number;
};

export type TeamProjectParticipant = {
  memberId: string;
  displayName: string;
  avatarUrl?: string;
  roleId: string;
  roleName: string;
  sectorId: string;
  sectorName: string;
};

export type TeamProjectSummary = ProjectSummary & {
  participants: TeamProjectParticipant[];
  sectorCount?: number;
  hasSystem?: boolean;
  organization?: import("../../shared/organization-tree.mjs").OrganizationNode;
  public?: boolean;
};

export function memberInitials(name: string): string {
  return name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function accessRoleLabel(role: AccessRole, language: Language): string {
  const labels: Record<AccessRole, Record<Language, string>> = {
    owner_admin: { pt: "Proprietário e administrador", en: "Owner and administrator" },
    captain: { pt: "Capitão", en: "Captain" },
    manager: { pt: "Gerente", en: "Manager" },
    member: { pt: "Membro", en: "Member" },
    advisor: { pt: "Orientador", en: "Advisor" }
  };
  return labels[role][language];
}

/** A stable accent per person, so avatars keep their colour across every view. */
export const MEMBER_PALETTE = ["#62aaff", "#33d4a0", "#a59cff", "#ef866d", "#e5b95f", "#5ad4e6"] as const;
export function memberColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MEMBER_PALETTE[hash % MEMBER_PALETTE.length];
}

/** Project types share one accent across cards, chart and chips. */
export function projectTypeLabel(type: string | undefined, language: Language): string {
  const labels: Record<string, [string, string]> = { competition: ["Competição", "Competition"], research: ["Pesquisa", "Research"], product: ["Produto", "Product"], custom: ["Personalizado", "Custom"] };
  return (labels[type || ""] || ["Projeto", "Project"])[language === "pt" ? 0 : 1];
}
