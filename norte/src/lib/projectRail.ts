import { FileText, Compass, ListChecks, ShieldCheck, CalendarDays } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "./types";

export type RailKey = "memory" | "conception" | "requirements" | "software" | "verification" | "schedule" | "operations";
export type RailStop = {
  key: RailKey;
  pt: string;
  en: string;
  Icon: LucideIcon;
  /** Phases answer to the pipeline's unlock rule; areas are always reachable. */
  step?: 0 | 1;
  area?: "requirements" | "verification" | "schedule";
  upcoming?: true;
};

/**
 * The single order of the project, used by the sidebar rail and by the
 * previous/next controls on every page, so they can never disagree.
 */
export const PROJECT_RAIL: RailStop[] = [
  { key: "memory", pt: "Memória do projeto", en: "Project memory", Icon: FileText, step: 0 },
  { key: "conception", pt: "Concepção", en: "Conception", Icon: Compass, step: 1 },
  { key: "requirements", pt: "Requisitos", en: "Requirements", Icon: ListChecks, area: "requirements" },
  { key: "verification", pt: "Verificação", en: "Verification", Icon: ShieldCheck, area: "verification" },
  { key: "schedule", pt: "Cronograma", en: "Schedule", Icon: CalendarDays, area: "schedule" }
];

export const railLabel = (stop: RailStop, language: Language) => language === "pt" ? stop.pt : stop.en;
export const railIndex = (key: RailKey) => PROJECT_RAIL.findIndex((stop) => stop.key === key);
export const railNeighbour = (key: RailKey, offset: -1 | 1): RailStop | undefined => PROJECT_RAIL[railIndex(key) + offset];
