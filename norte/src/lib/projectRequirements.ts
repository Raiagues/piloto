import { referenceProgram, programModality } from "./programs";
import type { MissionProject } from "./projectStore";
import type { Language } from "./types";

export type RequirementSource = "system" | "program";
export type VerificationMethod = "test" | "analysis" | "simulation" | "inspection";

export type ProjectRequirement = {
  id: string;
  title: string;
  statement: string;
  source: RequirementSource;
  origin: string;
  subsystem: string;
  method: VerificationMethod;
  /** Architecture elements this requirement is traced to, by name. */
  linked: string[];
  linkedIds: string[];
  /** Elements touched by a saved scenario or correction since the requirement was written. */
  changed: string[];
};

const METHODS: VerificationMethod[] = ["test", "analysis", "simulation", "inspection"];

export const METHOD_LABELS: Record<VerificationMethod, [string, string]> = {
  test: ["Ensaio", "Test"], analysis: ["Análise", "Analysis"], simulation: ["Simulação", "Simulation"], inspection: ["Inspeção", "Inspection"]
};

/** A stable method per requirement: the same row must not change method between renders. */
function methodFor(id: string, properties: { key: string }[]): VerificationMethod {
  if (properties.some((property) => /mass|thickness|power|energy|current|voltage|autonomy|margin/u.test(property.key))) return "analysis";
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return METHODS[hash % METHODS.length];
}

/**
 * One list, two origins: what the architecture demands of itself, and what the
 * reference programme demands of every team entering it. Programme rules are
 * quoted as written; nothing here is invented.
 */
export function projectRequirements(project: MissionProject, language: Language): ProjectRequirement[] {
  const pt = language === "pt";
  const model = project.engineeringSystem;
  const entityName = (id: string) => model?.entities.find((item) => item.id === id)?.name ?? id;
  const touched = new Set([
    ...(model?.scenarios ?? []).flatMap((scenario) => [scenario.changedEntityId, ...scenario.impacts.filter((impact) => impact.status !== "unaffected").map((impact) => impact.entityId)]),
    ...(model?.corrections ?? []).map((correction) => correction.targetId)
  ]);

  const system = (model?.requirements ?? []).map((requirement) => ({
    id: requirement.id,
    title: requirement.title,
    statement: requirement.statement,
    source: "system" as const,
    origin: pt ? "Arquitetura do sistema" : "System architecture",
    subsystem: requirement.subsystemTags[0] || (pt ? "Sem subsistema" : "Unassigned"),
    method: methodFor(requirement.id, requirement.properties),
    linked: requirement.relatedEntityIds.map(entityName),
    linkedIds: requirement.relatedEntityIds,
    changed: requirement.relatedEntityIds.filter((id) => touched.has(id)).map(entityName)
  }));

  const program = referenceProgram(project.context.programId);
  // A project that picked a programme but not a modality still answers to the
  // programme's rules; fall back to its first modality rather than showing none.
  const modality = programModality(program, project.context.modalityId) ?? program?.modalities[0] ?? null;
  const programRequirements = (modality?.requirements ?? []).map((requirement, index) => ({
    id: `${(program?.id ?? "prog").toUpperCase()}-${String(index + 1).padStart(2, "0")}`,
    title: requirement[language],
    statement: requirement[language],
    source: "program" as const,
    origin: `${program?.shortName ?? ""}${modality ? ` · ${modality.label[language]}` : ""}`.trim(),
    subsystem: pt ? "Programa" : "Programme",
    method: "inspection" as const,
    linked: [],
    linkedIds: [],
    changed: []
  }));

  return [...system, ...programRequirements];
}

export function requirementSubsystems(requirements: ProjectRequirement[]): string[] {
  return [...new Set(requirements.map((requirement) => requirement.subsystem))].sort((first, second) => first.localeCompare(second));
}
