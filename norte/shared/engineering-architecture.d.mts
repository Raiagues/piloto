import type { EngineeringSystemModel } from "../src/lib/engineeringSystem";
export type ArchitectureAliasCandidate = { canonicalId: string; entityIds: string[]; name: string; conflicts: string[]; descriptionFits: boolean };
export function architectureAliasCandidates(model: EngineeringSystemModel): ArchitectureAliasCandidate[];
export function mergeArchitectureAliases(model: EngineeringSystemModel, entityIds: string[]): EngineeringSystemModel;
