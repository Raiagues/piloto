export interface RequirementRule {id:string;profile:string;title:string;source:string;url:string;section:string;page:number|null;guidance:string;checkedAt:string;}
export interface RequirementFinding {id:string;ruleId:string|null;severity:'critical'|'warning'|'info';start:number|null;end:number|null;affectedText:string;title:string;explanation:string;suggestion:string;reference:RequirementRule|null;origin:string;}
export const REQUIREMENT_RULES:RequirementRule[];
export function activeRequirementRules(standards?:string[]):RequirementRule[];
export function inspectRequirement(requirement:{statement:string;method?:string;sourceRefs?:string[];artifactIds?:string[];parentIds?:string[]},standards?:string[]):{findings:RequirementFinding[];engine:string;checkedRules:string[];disclaimer:string};
export function validateRequirementAnalysis(output:unknown,requirement:{statement:string},rules:RequirementRule[]):RequirementFinding[];
