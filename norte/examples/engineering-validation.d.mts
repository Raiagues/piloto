import type { EngineeringChange, EngineeringSystemModel } from "../src/lib/engineeringSystem";
export const validationMemoryText: string;
export function createEngineeringValidationModel(): EngineeringSystemModel;
export function validationChange(key?: string, value?: number, unit?: string, targetEntityId?: string): EngineeringChange;
