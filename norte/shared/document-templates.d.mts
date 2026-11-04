export interface TemplateSection {
  heading: string;
  guide: string;
  fill: string;
}
export interface DocumentTemplate {
  id: string;
  code?: string;
  title: string;
  titles?: Record<string, string>;
  english: string;
  source: string;
  drd: string;
  reviews: Record<string, string>;
  sections: TemplateSection[];
}
export interface DocumentReference {
  title: string;
  edition?: string;
  url: string;
  section: string;
  org?: string;
}
export interface DocumentOption {
  id: string;
  code: string;
  title: string;
  english: string;
  kind: string;
  flow: string;
  profile: string;
  maturity: string;
  maturityKey: string;
  reference: DocumentReference | null;
  sections: string[];
}
export const TEMPLATE_SOURCES: Record<string, { org: string; title: string; edition: string; url: string }>;
export const MATURITY_LABELS: Record<string, string>;
export const DOCUMENT_TEMPLATES: Record<string, DocumentTemplate[]>;
export function documentPackage(profile: string, code?: string): DocumentOption[];
export function documentTemplate(profile: string, id: string): DocumentTemplate | null;
