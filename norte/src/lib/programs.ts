import type { Language } from "./types";

export type ProgramId = "obsat" | "lasc" | "sae-aerodesign" | "formula-sae" | "baja-sae";

export type OfficialProgramDocument = {
  id: string;
  label: Record<Language, string>;
  url: string;
  format: "web" | "pdf";
};

export type ProgramCategory = {
  id: string;
  label: Record<Language, string>;
  description: Record<Language, string>;
};

export type ProgramModality = {
  id: string;
  label: Record<Language, string>;
  description: Record<Language, string>;
  categories: ProgramCategory[];
  officialDocuments: OfficialProgramDocument[];
  requirements: Array<Record<Language, string>>;
  phases: Array<{
    id: string;
    label: Record<Language, string>;
    date: string;
    startDate?: string;
    endDate?: string;
    approximate?: boolean;
    url: string;
  }>;
  milestone: {
    label: Record<Language, string>;
    date: string;
    url: string;
  };
};

export type ReferenceProgram = {
  id: ProgramId;
  shortName: string;
  name: Record<Language, string>;
  description: Record<Language, string>;
  available: boolean;
  logoSrc?: string;
  modalities: ProgramModality[];
};

const practicalDocuments: OfficialProgramDocument[] = [
  {
    id: "obsat-practical-rules",
    label: { pt: "Edital da Modalidade Prática", en: "Practical Modality rules" },
    url: "https://wiki.obsat.org.br/books/modalidade-pratica",
    format: "web"
  },
  {
    id: "obsat-practical-schedule",
    label: { pt: "Cronograma oficial", en: "Official schedule" },
    url: "https://wiki.obsat.org.br/books/modalidade-pratica/page/cronograma",
    format: "web"
  }
];

const theoreticalDocuments: OfficialProgramDocument[] = [
  {
    id: "obsat-theoretical-rules",
    label: { pt: "Edital da Modalidade Teórica", en: "Theoretical Modality rules" },
    url: "https://wiki.obsat.org.br/books/modalidade-teorica",
    format: "web"
  },
  {
    id: "obsat-theoretical-schedule",
    label: { pt: "Cronograma oficial", en: "Official schedule" },
    url: "https://wiki.obsat.org.br/books/modalidade-teorica/page/cronograma",
    format: "web"
  }
];

// Selection metadata only. No inferred requirements, dates or technical parameters.
function competitionModality(id: string, pt: string, en: string, url: string, categories: [string, string, string][] = []): ProgramModality {
  return { id, label: { pt, en }, description: { pt: '', en: '' }, categories: categories.map(([id, pt, en]) => ({ id, label: { pt, en }, description: { pt: '', en: '' } })), officialDocuments: [{ id: `${id}-official`, label: { pt: 'Informações oficiais', en: 'Official information' }, url, format: 'web' }], requirements: [], phases: [], milestone: { label: { pt: '', en: '' }, date: '', url } };
}

export const REFERENCE_PROGRAMS: ReferenceProgram[] = [
  {
    id: "obsat",
    shortName: "OBSAT",
    name: { pt: "Olimpíada Brasileira de Satélites", en: "Brazilian Satellite Olympiad" },
    description: {
      pt: "Planejamento, construção, testes e operação de pequenos satélites.",
      en: "Planning, construction, testing, and operation of small satellites."
    },
    available: true,
    logoSrc: `${import.meta.env.BASE_URL}brand/obsat-logo.png`,
    modalities: [
      {
        id: "practical",
        label: { pt: "Modalidade Prática", en: "Practical Modality" },
        description: {
          pt: "Equipes concebem uma missão e desenvolvem um protótipo de pequeno satélite.",
          en: "Teams conceive a mission and develop a small-satellite prototype."
        },
        categories: [
          { id: "n1", label: { pt: "N1 · Fundamental II", en: "N1 · Lower secondary" }, description: { pt: "Categoria definida pelo estudante de maior escolaridade.", en: "Category determined by the most advanced student." } },
          { id: "n2", label: { pt: "N2 · Médio ou Técnico", en: "N2 · Upper secondary or technical" }, description: { pt: "Categoria para estudantes do ensino médio ou técnico.", en: "Category for upper-secondary or technical students." } },
          { id: "n3", label: { pt: "N3 · Ensino Superior", en: "N3 · Higher education" }, description: { pt: "Categoria para equipes universitárias.", en: "Category for university teams." } }
        ],
        officialDocuments: practicalDocuments,
        requirements: [
          { pt: "Definir o problema, os objetivos da missão e o mérito científico", en: "Define the problem, mission objectives, and scientific merit" },
          { pt: "Projetar carga útil e módulo de serviço como um sistema integrado", en: "Design payload and service module as an integrated system" },
          { pt: "Descrever subsistemas essenciais e a operação da missão", en: "Describe essential subsystems and mission operations" },
          { pt: "Registrar materiais, métodos, requisitos e restrições", en: "Record materials, methods, requirements, and constraints" },
          { pt: "Planejar desenvolvimento, testes, responsabilidades e entregas", en: "Plan development, tests, responsibilities, and deliverables" },
          { pt: "Considerar estrutura, armazenamento de dados, energia e telemetria da fase vigente", en: "Consider structure, data storage, power, and telemetry for the current phase" }
        ],
        phases: [
          { id: "training", label: { pt: "Fase 0 · Treinamento", en: "Phase 0 · Training" }, date: "24/02–10/12/2025", startDate: "2025-02-24", endDate: "2025-12-10", url: "https://wiki.obsat.org.br/books/modalidade-pratica/page/cronograma" },
          { id: "planning", label: { pt: "Fase 1 · Planejamento de missão", en: "Phase 1 · Mission planning" }, date: "24/02–26/10/2025", startDate: "2025-02-24", endDate: "2025-10-26", url: "https://wiki.obsat.org.br/books/modalidade-pratica/page/fase-1-planejamento-de-missao-imagine-o-seu-satelite" },
          { id: "build", label: { pt: "Fase 2 · Construção, programação e testes", en: "Phase 2 · Build, program, and test" }, date: "27/10/2025–01/05/2026", startDate: "2025-10-27", endDate: "2026-05-01", url: "https://wiki.obsat.org.br/books/modalidade-pratica/page/fase-2-construa-programe-teste-seu-satelite" },
          { id: "regional", label: { pt: "Fase 3 · Etapas regionais", en: "Phase 3 · Regional events" }, date: "05–09/2026", startDate: "2026-05-01", endDate: "2026-09-30", url: "https://wiki.obsat.org.br/books/modalidade-pratica/page/cronograma" },
          { id: "national", label: { pt: "Fase 4 · Etapa nacional", en: "Phase 4 · National event" }, date: "2º semestre de 2026", startDate: "2026-07-01", endDate: "2026-12-31", approximate: true, url: "https://wiki.obsat.org.br/books/modalidade-pratica/page/cronograma" }
        ],
        milestone: {
          label: { pt: "Regional Sudeste 2 · LASC", en: "Southeast Regional 2 · LASC" },
          date: "02–05/09/2026",
          url: "https://wiki.obsat.org.br/books/modalidade-pratica/page/cronograma"
        }
      },
      {
        id: "theoretical",
        label: { pt: "Modalidade Teórica", en: "Theoretical Modality" },
        description: {
          pt: "Avaliações online por nível escolar, com conteúdo aeroespacial integrado ao currículo.",
          en: "Online assessments by school level, integrating space topics into the curriculum."
        },
        categories: [
          { id: "nt1", label: { pt: "NT1 · 1º ano", en: "NT1 · Year 1" }, description: { pt: "Ensino Fundamental.", en: "Primary education." } },
          { id: "nt2", label: { pt: "NT2 · 2º e 3º anos", en: "NT2 · Years 2 and 3" }, description: { pt: "Ensino Fundamental.", en: "Primary education." } },
          { id: "nt3", label: { pt: "NT3 · 4º e 5º anos", en: "NT3 · Years 4 and 5" }, description: { pt: "Ensino Fundamental.", en: "Primary education." } },
          { id: "nt4", label: { pt: "NT4 · 6º e 7º anos", en: "NT4 · Years 6 and 7" }, description: { pt: "Ensino Fundamental.", en: "Lower-secondary education." } },
          { id: "nt5", label: { pt: "NT5 · 8º e 9º anos", en: "NT5 · Years 8 and 9" }, description: { pt: "Ensino Fundamental.", en: "Lower-secondary education." } },
          { id: "nt6", label: { pt: "NT6 · Médio ou Técnico", en: "NT6 · Upper secondary or technical" }, description: { pt: "Ensino médio e técnico.", en: "Upper-secondary and technical education." } }
        ],
        officialDocuments: theoreticalDocuments,
        requirements: [
          { pt: "Acompanhar o conteúdo e o cronograma do nível selecionado", en: "Follow the content and schedule for the selected level" },
          { pt: "Registrar estudos, dúvidas e evidências de aprendizagem", en: "Record studies, questions, and learning evidence" }
        ],
        phases: [],
        milestone: {
          label: { pt: "Fase 1 · avaliação online", en: "Phase 1 · online assessment" },
          date: "14–17/09/2026",
          url: "https://wiki.obsat.org.br/books/modalidade-teorica/page/cronograma"
        }
      }
    ]
  },
  {
    id: "lasc",
    shortName: "LASC",
    name: { pt: "Latin American Space Challenge", en: "Latin American Space Challenge" },
    description: { pt: "Desafios universitários de foguetes e sistemas espaciais.", en: "University challenges for rockets and space systems." },
    available: true,
    modalities: [competitionModality('rocket', 'Rocket Challenge', 'Rocket Challenge', 'https://www.lasc.space/2026-lasc/documentation'), competitionModality('satellite', 'Satellite Challenge', 'Satellite Challenge', 'https://www.lasc.space/2026-lasc/documentation'), competitionModality('lander', 'Lander Challenge', 'Lander Challenge', 'https://www.lasc.space/2026-lasc/documentation')]
  },
  {
    id: "sae-aerodesign",
    shortName: "SAE AeroDesign",
    name: { pt: "SAE Brasil AeroDesign", en: "SAE Brasil AeroDesign" },
    description: { pt: "Projeto e competição de aeronaves radiocontroladas.", en: "Radio-controlled aircraft design competition." },
    available: true,
    modalities: [competitionModality('aircraft', 'Aeronaves', 'Aircraft', 'https://legado.saebrasil.org.br/programas-estudantis/aero-design-sae-brasil/', [['regular', 'Regular', 'Regular'], ['advanced', 'Advanced', 'Advanced'], ['micro', 'Micro', 'Micro']])]
  },
  {
    id: "formula-sae",
    shortName: "Formula SAE",
    name: { pt: "Fórmula SAE Brasil", en: "Formula SAE Brazil" },
    description: { pt: "Desenvolvimento universitário de veículo monoposto.", en: "University single-seat vehicle development." },
    available: true,
    modalities: [competitionModality('vehicle', 'Veículos', 'Vehicles', 'https://legado.saebrasil.org.br/programas-estudantis/formula-sae-brasil/informacoes/', [['combustion', 'Combustão', 'Combustion'], ['electric', 'Elétrica', 'Electric']])]
  },
  {
    id: "baja-sae",
    shortName: "Baja SAE",
    name: { pt: "Baja SAE Brasil", en: "Baja SAE Brazil" },
    description: { pt: "Projeto universitário de veículo fora de estrada.", en: "University off-road vehicle design." },
    available: true,
    modalities: [competitionModality('offroad', 'Fora de estrada', 'Off-road', 'https://saebrasil.org.br/programas-estudantis/baja-sae-brasil/')]
  }
];

export function referenceProgram(programId: string | null | undefined): ReferenceProgram | null {
  return REFERENCE_PROGRAMS.find((program) => program.id === programId) ?? null;
}

export function programModality(program: ReferenceProgram | null, modalityId: string | null | undefined): ProgramModality | null {
  return program?.modalities.find((modality) => modality.id === modalityId) ?? null;
}

export function programCategory(modality: ProgramModality | null, categoryId: string | null | undefined): ProgramCategory | null {
  return modality?.categories.find((category) => category.id === categoryId) ?? null;
}
