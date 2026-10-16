import type { EngineeringAnalysis, EngineeringChange, EngineeringSystemModel } from "../src/lib/engineeringSystem";
export function analyzeImpact(model: EngineeringSystemModel, change: EngineeringChange, language?: "pt" | "en"): EngineeringAnalysis;
export function normalizeQuantity(value: number, unit: string): { value: number; dimension: string; unit: string } | null;
export function impactEdges(model: EngineeringSystemModel): { from: string; to: string; id: string; source: string; evidenceRefs: string[] }[];
