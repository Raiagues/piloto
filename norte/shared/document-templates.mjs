// Review data packages and document outlines.
// ECSS: ECSS-E-ST-10C Rev.1 (15 Feb 2017) Annex A, Table A-1, and the DRDs it calls up, read 2026-11-03.
// NASA: NPR 7123.1D 5.2.2.2 and Appendix G; outlines from NASA/SP-2016-6105 Rev2 appendices.
// Headings follow the DRD/appendix; guidance lines are short paraphrases, not the standard's text.
// The package is a planning proposal: the business agreement and approved tailoring define what applies.

export const TEMPLATE_SOURCES = {
  ecssEngineering: {
    org: 'ECSS',
    title: 'System engineering general requirements',
    edition: 'ECSS-E-ST-10C Rev.1 · 15 fev. 2017',
    url: 'https://ecss.nl/standard/ecss-e-st-10c-rev-1-system-engineering-general-requirements-15-february-2017/',
  },
  ecssSpec: {
    org: 'ECSS',
    title: 'Technical requirements specification',
    edition: 'ECSS-E-ST-10-06C · 6 mar. 2009',
    url: 'https://ecss.nl/standard/ecss-e-st-10-06c-technical-requirements-specification/',
  },
  ecssVerification: {
    org: 'ECSS',
    title: 'Verification',
    edition: 'ECSS-E-ST-10-02C Rev.1 · 1 fev. 2018',
    url: 'https://ecss.nl/standard/ecss-e-st-10-02c-rev-1-verification-1-february-2018/',
  },
  ecssInterfaces: {
    org: 'ECSS',
    title: 'Interface management',
    edition: 'ECSS-E-ST-10-24C Rev.1 · 15 nov. 2024',
    url: 'https://ecss.nl/standard/ecss-e-st-10-24c-rev-1-interface-management-15-november-2024/',
  },
  ecssTesting: {
    org: 'ECSS',
    title: 'Testing',
    edition: 'ECSS-E-ST-10-03C Rev.1 · 31 mai. 2022',
    url: 'https://ecss.nl/active-standards/ecss-e-st-10-03c-rev-1-testing-31-may-2022/',
  },
  ecssManagement: {
    org: 'ECSS',
    title: 'Project planning and implementation',
    edition: 'ECSS-M-ST-10C Rev.1 · 6 mar. 2009',
    url: 'https://ecss.nl/standard/ecss-m-st-10c-rev-1-project-planning-and-implementation/',
  },
  ecssDebris: {
    org: 'ECSS',
    title: 'Space sustainability — adoption of ISO 24113',
    edition: 'ECSS-U-AS-10C Rev.2 · 9 fev. 2024',
    url: 'https://ecss.nl/wp-content/uploads/2024/02/ECSS-U-AS-10C-Rev.2-(9February2024).pdf',
  },
  nasaProcess: {
    org: 'NASA',
    title: 'NASA Systems Engineering Processes and Requirements',
    edition: 'NPR 7123.1D',
    url: 'https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_7123_001D_&page_name=Chapter5',
  },
  nasaCriteria: {
    org: 'NASA',
    title: 'Life-cycle review entrance and success criteria',
    edition: 'NPR 7123.1D · Apêndice G',
    url: 'https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_7123_001D_&page_name=AppendixG',
  },
  nasaHandbook: {
    org: 'NASA',
    title: 'NASA Systems Engineering Handbook',
    edition: 'NASA/SP-2016-6105 Rev2',
    url: 'https://www.nasa.gov/sites/default/files/atoms/files/nasa_systems_engineering_handbook_0.pdf',
  },
};

export const MATURITY_LABELS = {
  issue: 'Primeira emissão',
  preliminary: 'Versão preliminar',
  update: 'Atualização',
  final: 'Versão final da revisão',
  baseline: 'Linha de base',
  approve: 'Aprovação',
  initial: 'Versão inicial',
  matrix: 'Somente a matriz de verificação',
  trsl: 'Somente a lista de prontidão tecnológica (TRSL)',
  selection: 'Seleção da Norte, fora da Tabela A-1',
};

// A section: [heading, guidance, fill?]. "###" marks a subsection. Fills draw on records that already exist.
const s = (heading, guide, fill = '') => ({ heading, guide, fill });
const intro = s('1 Introdução', 'Propósito, objetivo e conteúdo do documento e o motivo da sua preparação.', 'purpose');
const docs = (extra = '') =>
  s(
    '2 Documentos aplicáveis e de referência',
    `Liste as edições aplicáveis e de referência usadas na preparação.${extra ? ` ${extra}` : ''}`,
    'references',
  );
const terms = number =>
  s(
    `${number} Termos, definições e abreviaturas`,
    'Indique o glossário aplicável e o significado de termos e siglas específicos.',
  );

const tradeOff = [
  intro,
  docs(),
  s(
    '3 Objetivo e contexto do estudo',
    'Propósito do estudo de trade-off e seu contexto (lógica, organização, processo).',
  ),
  s(
    '4 Requisitos técnicos-chave',
    'Requisitos-chave da especificação técnica que as alternativas precisam atender.',
    'requirement-summary',
  ),
  s('5 Critérios de avaliação', 'Critérios escolhidos tema a tema, com justificativa e peso de cada um.', 'criteria'),
  s(
    '6 Soluções alternativas',
    'Cada alternativa proposta (organização, cliente e fornecedores), com a descrição técnica ligada aos critérios.',
  ),
  s('7 Avaliação das alternativas', 'Resultado da avaliação de cada alternativa em relação aos requisitos-chave.'),
  s('8 Classificação', 'Classificação das alternativas segundo a ponderação dos critérios.'),
  s(
    '9 Robustez da classificação',
    'Análise de sensibilidade dos critérios que favorecem a solução classificada em primeiro lugar.',
  ),
  s('10 Conclusão', 'Solução recomendada, razões da escolha e condições de aplicação; riscos técnicos identificados.'),
];

const ecss = [
  {
    id: 'MDD',
    title: 'Documento de descrição da missão',
    english: 'Mission description document',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo B (DRD)',
    reviews: { MDR: 'issue', PRR: 'final' },
    sections: [
      intro,
      docs('Inclua, no mínimo, a especificação técnica preliminar vigente.'),
      s(
        '3 Resumo da especificação técnica preliminar',
        'Objetivos da especificação preliminar e lista dos requisitos que dirigem o projeto.',
        'requirement-summary',
      ),
      s(
        '4 Descrição do conceito',
        'Visão geral do conceito, análise de missão, descrição elemento por elemento (segmentos espacial, solo e usuário) e funcionamento em cada fase da missão: dirigentes de desempenho, restrições, eventos principais e cenários de operação.',
        'architecture',
      ),
      s(
        '5 Avaliação do desempenho',
        'Avaliação frente aos requisitos da especificação preliminar; não conformidades e seu impacto.',
      ),
      s('6 Áreas de risco', 'Riscos do conceito: tecnologia, tratamento de contingências e aspectos programáticos.'),
      s('7 Conclusão', 'Pontos fortes e fracos do conceito.'),
    ],
  },
  {
    id: 'SCR',
    title: 'Relatório de conceito do sistema',
    english: 'System concept report',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo C (DRD; estrutura do Anexo L)',
    reviews: { MDR: 'issue', PRR: 'final' },
    sections: tradeOff,
  },
  {
    id: 'TOR',
    title: 'Relatório de trade-off',
    english: 'Trade-off report',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo L (DRD)',
    reviews: { MDR: 'issue', PRR: 'update', SRR: 'update', PDR: 'update', CDR: 'final' },
    sections: tradeOff,
  },
  {
    id: 'REQ',
    code: 'TS',
    title: 'Especificação técnica',
    titles: { MDR: 'Especificação técnica preliminar', PRR: 'Especificação técnica preliminar' },
    english: 'Technical requirements specification',
    source: 'ecssSpec',
    drd: 'ECSS-E-ST-10-06C · Anexo A (DRD)',
    reviews: { MDR: 'preliminary', PRR: 'preliminary', SRR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Necessidade do usuário',
        'Elementos que caracterizam a necessidade do usuário e a relação do produto com outros produtos.',
      ),
      s(
        '4 Conceito ou produto selecionado',
        'Conceito, arquitetura esperada e princípios de funcionamento.',
        'architecture',
      ),
      s(
        '5 Perfil de vida',
        'Situações cronológicas da vida do produto: montagem e ensaios, transporte, preparação e lançamento, operação, descarte.',
      ),
      s(
        '6 Ambientes e restrições',
        'Ambientes e restrições de cada situação do perfil de vida; identifique cada ambiente para ligá-lo aos requisitos.',
      ),
      s(
        '7 Requisitos',
        'Todos os requisitos técnicos necessários, um por enunciado, com identificador único e método de verificação (ECSS-E-ST-10-06C, cláusula 8).',
        'requirements',
      ),
    ],
  },
  {
    id: 'RJF',
    title: 'Arquivo de justificativa de requisitos',
    english: 'Requirements justification file',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo O (DRD)',
    reviews: { MDR: 'issue', PRR: 'update', SRR: 'update', PDR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Justificativa do conceito selecionado',
        'Razões da escolha do conceito usado na especificação técnica; pode remeter ao relatório de conceito.',
      ),
      s('4 Justificativa do perfil de vida', 'Situações do perfil de vida do conceito e sua justificativa.'),
      s(
        '5 Justificativa de ambientes e restrições',
        'Ambientes e restrições de cada situação do perfil de vida e sua justificativa.',
      ),
      s(
        '6 Justificativa dos requisitos técnicos',
        'Para cada requisito: justificativa, origem e responsável pela especificação.',
        'justification',
      ),
      s(
        '7 Rastreabilidade',
        'Rastreabilidade entre os requisitos da especificação e sua origem justificada.',
        'traceability',
      ),
      s(
        '8 Matriz de conformidade de COTS',
        'Para itens comerciais, conformidade entre suas características e os requisitos da especificação.',
      ),
    ],
  },
  {
    id: 'SEMP',
    code: 'SEP',
    title: 'Plano de engenharia de sistemas',
    english: 'System engineering plan',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo D (DRD)',
    reviews: { MDR: 'issue', PRR: 'update', SRR: 'update', PDR: 'update', CDR: 'update', QR: 'update', AR: 'final' },
    sections: [
      intro,
      docs(),
      s('3 Visão geral do projeto', 'Contexto do esforço de engenharia de sistemas nas fases cobertas pelo plano.'),
      s(
        '### 3.1 Objetivos e restrições do projeto',
        'Objetivo do projeto, necessidade do usuário e objetivo do produto conforme a especificação técnica.',
      ),
      s(
        '### 3.2 Lógica de evolução do produto',
        'Implementação progressiva das funções, versões sucessivas e sua estratégia.',
      ),
      s(
        '### 3.3 Fases, revisões e planejamento',
        'Marcos principais, fases e revisões que dirigem o processo de engenharia de sistemas.',
        'lifecycle',
      ),
      s(
        '### 3.4 Estratégia de aquisição',
        'Estratégia para obter os itens da árvore de produto (fazer ou comprar, linha de produto, desenvolvimento incremental).',
      ),
      s(
        '### 3.5 Questões críticas iniciais',
        'Questões que exigem atenção, investigação e planejamento dedicados desde o início.',
      ),
      s('4 Abordagem de projeto do sistema', 'Como a engenharia de sistemas conduz o projeto nas fases cobertas.'),
      s(
        '### 4.1 Entradas da engenharia de sistemas',
        'Entradas que dirigem as atividades: acordo comercial, especificações, normas aplicáveis.',
      ),
      s(
        '### 4.2 Saídas da engenharia de sistemas',
        'Saídas especificadas para as fases cobertas; a Tabela A-1 indica as entregas por revisão.',
        'package',
      ),
      s(
        '### 4.3 Responsabilidades e organização',
        'Entidades participantes, funções e papéis-chave de engenharia.',
        'organization',
      ),
      s('### 4.4 Coordenação', 'Coordenação interna e externa, alinhada ao plano de gestão do projeto.'),
      s('5 Implementação e planos relacionados', 'Processo de engenharia de sistemas adaptado ao projeto.'),
      s(
        '### 5.1 Tarefas de engenharia de sistemas',
        'Tarefas do início (kick-off) ao evento de encerramento (revisão), integração das disciplinas e pacotes de trabalho.',
      ),
      s(
        '### 5.2 Planos relacionados',
        'Planos programáticos, de verificação e de disciplinas que fazem parte do plano ou são chamados por ele.',
      ),
      s(
        '### 5.3 Métodos, ferramentas e modelos',
        'Métodos, ferramentas e modelos de dados usados, inclusive para rastreabilidade e controle de verificação.',
      ),
      s('### 5.4 Questões críticas', 'Problemas da fase atual que exigem atenção, riscos e medidas de mitigação.'),
      s(
        '6 Engenharia de sistemas nas fases seguintes',
        'Atividades previstas para as fases seguintes e riscos a mitigar nelas.',
      ),
    ],
  },
  {
    id: 'IRD',
    title: 'Documento de requisitos de interface',
    english: 'Interface requirements document',
    source: 'ecssInterfaces',
    drd: 'ECSS-E-ST-10-24C Rev.1 · Anexo A (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'final' },
    sections: [
      intro,
      docs('Inclua as árvores de produto e de especificações e defina a precedência do documento.'),
      terms(3),
      s(
        '4 Requisitos de interface',
        'Requisitos físicos, funcionais, procedimentais e operacionais entre itens da árvore de produto, redigidos conforme a ECSS-E-ST-10-06, com verificação, responsável e aplicabilidade a cada extremidade da interface.',
        'interfaces',
      ),
    ],
  },
  {
    id: 'ICD',
    title: 'Documento de controle de interface',
    english: 'Interface control document',
    source: 'ecssInterfaces',
    drd: 'ECSS-E-ST-10-24C Rev.1 · Anexo B (DRD)',
    reviews: {
      SRR: 'issue',
      PDR: 'update',
      CDR: 'update',
      QR: 'update',
      AR: 'update',
      ORR: 'update',
      FRR: 'update',
      LRR: 'final',
    },
    sections: [
      intro,
      s('2 Responsabilidade', 'Responsável pela interface e atores que contribuem para sua definição.'),
      s(
        '3 Documentos aplicáveis e de referência',
        'Edições aplicáveis, inclusive o documento de requisitos de interface.',
        'references',
      ),
      terms(4),
      s(
        '5 Definição da interface',
        'Para cada interface: plano de interface, comportamento e limites de uso, descrição (tabelas, desenhos, modelos), dados, unidades, tolerâncias e conversões.',
        'interfaces',
      ),
    ],
  },
  {
    id: 'TP',
    title: 'Plano de tecnologia',
    titles: { MDR: 'Lista de prontidão tecnológica (TRSL)' },
    english: 'Technology plan',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo E (DRD)',
    reviews: { MDR: 'trsl', PRR: 'issue', SRR: 'update', PDR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Visão geral do projeto',
        'Resumo dos objetivos, da evolução do produto, das fases e revisões (seções 3.1 a 3.3 do plano de engenharia de sistemas).',
      ),
      s(
        '4 Tarefas',
        'Saídas esperadas, entradas por função (requisito, tecnologia e TRL, riscos, cronograma), tarefas de aquisição de cada tecnologia, responsabilidades e interfaces.',
      ),
      s(
        '5 Questões tecnológicas e TRSL',
        'Ações de mitigação por risco tecnológico conforme o TRL e a lista de prontidão tecnológica (modelo da Figura E-1).',
        'trsl',
      ),
    ],
  },
  {
    id: 'TM',
    title: 'Matriz de tecnologia',
    english: 'Technology matrix',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo F (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Requisitos técnicos e funções',
        'Funções e requisitos técnicos do sistema, conforme a arquitetura funcional e a árvore de funções.',
        'requirement-summary',
      ),
      s(
        '4 Tecnologias potenciais',
        'Para cada função, as tecnologias ou elementos tecnológicos possíveis (fontes: prospecção tecnológica, herança).',
      ),
      s('5 Classificação das tecnologias', 'Classificação proposta das tecnologias para cada função.'),
      s('6 Conclusão', 'Tecnologia selecionada por função, riscos e aspectos críticos e solução de reserva.'),
    ],
  },
  {
    id: 'FT',
    title: 'Árvore de funções',
    english: 'Function tree',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo H (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Resumo do projeto e necessidade do usuário',
        'Descrição breve do projeto e das necessidades-chave do usuário.',
      ),
      s(
        '4 Estrutura da árvore',
        'Lista completa de funções, da função principal no topo às funções de nível inferior. Os grupos abaixo vêm dos requisitos registrados e precisam ser revistos.',
        'functions',
      ),
    ],
  },
  {
    id: 'PT',
    title: 'Árvore de produto',
    english: 'Product tree',
    source: 'ecssManagement',
    drd: 'ECSS-M-ST-10C Rev.1 · Anexo B (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Estrutura da árvore de produto',
        'Decomposição hierárquica do produto até os itens de configuração, com identificação única de cada item.',
        'products',
      ),
    ],
  },
  {
    id: 'ST',
    title: 'Árvore de especificações',
    english: 'Specification tree',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo J (DRD)',
    reviews: { SRR: 'issue', PDR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Resumo do projeto e necessidade do usuário',
        'Descrição breve do projeto e das necessidades-chave do usuário.',
      ),
      s(
        '4 Estrutura da árvore',
        'Lista completa das especificações, da especificação do sistema às especificações dos produtos de nível inferior.',
        'specifications',
      ),
    ],
  },
  {
    id: 'ARQ',
    code: 'DDF',
    title: 'Arquivo de definição do projeto',
    english: 'Design definition file',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo G (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'update', CDR: 'update', QR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Resumo do projeto e dos requisitos técnicos',
        'Descrição do produto e dos requisitos técnicos principais ao longo das fases da vida.',
        'requirement-summary',
      ),
      s(
        '4 Descrição funcional',
        'Arquitetura funcional, árvore de funções (Anexo H) e cadeias funcionais por modo de operação.',
      ),
      s(
        '5 Descrição física',
        'Arquitetura física, árvore de produto, árvore de especificações, elementos e interfaces.',
        'architecture',
      ),
      s(
        '### 5.5 Interfaces',
        'Características físicas e funcionais das interfaces internas e externas, com referência ao IRD e ao ICD.',
        'interfaces',
      ),
      s(
        '6 Orçamentos técnicos, margens e desvios',
        'Alocação dos parâmetros técnicos e situação atual das margens; remete ao orçamento técnico (Anexo I).',
      ),
      s(
        '7 Restrições de projeto',
        'Restrições impostas à produção, à operação, ao transporte e armazenamento e à manutenibilidade.',
      ),
      s('8 Repositório de dados de engenharia', 'Conjunto completo de parâmetros de projeto ou referência a ele.'),
      s('9 Conclusão', 'Desvios do projeto em relação às especificações e restrições.'),
    ],
  },
  {
    id: 'TB',
    title: 'Orçamento técnico',
    english: 'Technical budget',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo I (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'update', CDR: 'update', QR: 'update', AR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Parâmetros-chave de engenharia',
        'Parâmetros-chave especificados pelo cliente e selecionados pelo fornecedor. Os candidatos abaixo vêm de requisitos com grandezas físicas.',
        'budget',
      ),
      s(
        '4 Avaliação dos parâmetros',
        'Para cada parâmetro: valor especificado, margem do fornecedor, alocação aos produtos de nível inferior, estimativa atual e margem resultante.',
      ),
      s(
        '5 Conclusão',
        'Parâmetros com margem negativa, seu impacto e risco, e o programa para recuperar a conformidade.',
      ),
    ],
  },
  {
    id: 'DJF',
    title: 'Arquivo de justificativa do projeto',
    english: 'Design justification file',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo K (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'update', CDR: 'update', QR: 'final' },
    sections: [
      intro,
      docs(),
      s('3 Descrição do projeto', 'Produto esperado, missão, arquitetura, projeto e princípios de funcionamento.'),
      s(
        '4 Síntese da justificativa',
        'Situação da justificativa frente aos requisitos, com ênfase nos que dirigem o projeto, e situação geral da qualificação.',
        'verification-status',
      ),
      s(
        '5 Justificativa da arquitetura funcional',
        'Demonstração de que todos os requisitos estão alocados a blocos funcionais.',
      ),
      s(
        '6 Justificativa da arquitetura física',
        'Demonstração de conformidade à especificação técnica e identificação de itens reutilizados (COTS).',
      ),
      s(
        '7 Atividades de desenvolvimento',
        'Avaliações, análises, ensaios e trade-offs que levaram ao projeto definido no arquivo de definição.',
      ),
      s(
        '8 Verificação e síntese dos resultados',
        'Plano de verificação, evidências de qualificação, validação de modelos, registro da situação de cada requisito e verificação de aceitação.',
        'verification-matrix',
      ),
      s(
        '9 Orçamentos e margens',
        'Síntese dos orçamentos técnicos e margens segundo as arquiteturas funcional e física.',
      ),
      s(
        '10 Restrições impostas pelo projeto',
        'Justificativa das restrições à produção, operação, transporte e armazenamento e manutenção.',
      ),
      s(
        '11 Documentos constituintes',
        'Relatórios de trade-off e de análise, justificativa e rastreabilidade de requisitos e demais documentos integrados ou referidos.',
      ),
    ],
  },
  {
    id: 'RTM',
    title: 'Matriz de rastreabilidade de requisitos',
    english: 'Requirements traceability matrix',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo N (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'final' },
    sections: [
      intro,
      docs(),
      s(
        '3 Rastreabilidade de requisitos',
        'Todos os requisitos técnicos da especificação e dos elementos de nível inferior, com a mesma identificação usada nas especificações.',
        'traceability',
      ),
    ],
  },
  {
    id: 'VVP',
    code: 'VP',
    title: 'Plano de verificação',
    english: 'Verification plan',
    source: 'ecssVerification',
    drd: 'ECSS-E-ST-10-02C Rev.1 · Anexo A (DRD)',
    reviews: { PRR: 'issue', SRR: 'update', PDR: 'update', CDR: 'update', QR: 'update', AR: 'final' },
    sections: [
      intro,
      docs(),
      terms(3),
      s('4 Objeto da verificação', 'Descrição breve do objeto do processo de verificação.'),
      s('5 Abordagem de verificação', 'Conceitos e definições básicas: métodos, níveis e estágios.'),
      s('6 Filosofia de modelos', 'Modelos selecionados, filosofia de modelos e matriz de produtos.'),
      s(
        '7 Estratégia de verificação',
        'Combinação de métodos por nível e estágio, por tipo de requisito, e alocação dos requisitos às tarefas de verificação.',
        'method-allocation',
      ),
      s(
        '8 Programa de verificação',
        'Atividades de verificação e seu planejamento em cada estágio (análise, revisão de projeto, inspeção e ensaio).',
        'verification-activities',
      ),
      s(
        '9 Ferramentas de verificação',
        'Instalações de software, ferramentas especiais, simuladores e ferramentas analíticas.',
      ),
      s(
        '10 Metodologia de controle',
        'Monitoramento e controle da verificação, inclusive a base de dados de verificação.',
      ),
      s('11 Documentação', 'Documentos de verificação envolvidos e seu conteúdo.'),
      s(
        '12 Organização e gestão',
        'Responsabilidades, relação com garantia do produto, controle de qualidade e configuração (anomalias e mudanças).',
      ),
    ],
  },
  {
    id: 'VCD',
    title: 'Documento de controle de verificação',
    english: 'Verification control document',
    source: 'ecssVerification',
    drd: 'ECSS-E-ST-10-02C Rev.1 · Anexo B (DRD)',
    reviews: {
      PRR: 'matrix',
      SRR: 'matrix',
      PDR: 'matrix',
      CDR: 'issue',
      QR: 'update',
      AR: 'update',
      ORR: 'update',
      FRR: 'update',
      LRR: 'update',
      CRR: 'update',
      ELR: 'update',
      MCR: 'final',
    },
    sections: [
      intro,
      docs(),
      terms(3),
      s(
        '4 Objeto da verificação',
        'Abordagem de controle, documentação envolvida, ferramenta usada e requisitos a verificar com métodos, níveis e estágios.',
      ),
      s('5 Situação resumida da verificação', 'Situação atual do encerramento da verificação.', 'verification-status'),
      s(
        '6 Dados de controle da verificação',
        'Matriz por requisito: identificador, texto, rastreabilidade, níveis e estágios, métodos, vínculo ao plano e situação de encerramento com evidências.',
        'verification-matrix',
      ),
    ],
  },
  {
    id: 'AIT',
    title: 'Plano de montagem, integração e ensaios (QM/FM)',
    english: 'AIT QM/FM plan',
    source: 'ecssTesting',
    drd: 'ECSS-E-ST-10-03C · Anexo A (DRD), conforme a Tabela A-1',
    reviews: { PDR: 'issue', CDR: 'update', QR: 'update', AR: 'final', TRR: 'selection' },
    sections: [
      intro,
      docs('Confirme a estrutura da DRD na edição adotada.'),
      s('3 Produto e modelos', 'Produto, modelos de qualificação e de voo e sua configuração.'),
      s(
        '4 Programa de montagem, integração e ensaios',
        'Sequência de atividades, fluxograma e ensaios de cada modelo.',
        'verification-activities',
      ),
      s('5 Instalações e equipamentos de apoio', 'Instalações de ensaio, equipamentos de apoio em solo e ferramentas.'),
      s(
        '6 Organização e documentação',
        'Responsabilidades, especificações, procedimentos e relatórios de ensaio associados.',
      ),
    ],
  },
  {
    id: 'TSP',
    title: 'Especificação de ensaio',
    english: 'Test specification',
    source: 'ecssTesting',
    drd: 'ECSS-E-ST-10-03C · Anexo B (DRD), conforme a Tabela A-1',
    reviews: { CDR: 'issue', QR: 'update', AR: 'final', TRR: 'selection' },
    sections: [
      intro,
      docs('Confirme a estrutura da DRD na edição adotada.'),
      s(
        '3 Requisitos a verificar',
        'Requisitos cobertos pelo ensaio, com referência ao documento de controle de verificação.',
        'test-requirements',
      ),
      s('4 Objetivo, artigo e configuração do ensaio', 'Objetivos, artigo em ensaio e configuração.'),
      s('5 Condições, níveis e tolerâncias', 'Condições ambientais, níveis, durações e tolerâncias de ensaio.'),
      s('6 Critérios de sucesso', 'Critérios de aceitação de cada medição.'),
    ],
  },
  {
    id: 'TPR',
    title: 'Procedimento de ensaio',
    english: 'Test procedure',
    source: 'ecssTesting',
    drd: 'ECSS-E-ST-10-03C · Anexo C (DRD), conforme a Tabela A-1',
    reviews: { CDR: 'issue', QR: 'update', AR: 'update', ORR: 'update', FRR: 'final', TRR: 'selection' },
    sections: [
      intro,
      docs('Confirme a estrutura da DRD na edição adotada.'),
      s('3 Configuração e instrumentação', 'Configuração do artigo, montagem, instrumentação e calibração.'),
      s('4 Sequência passo a passo', 'Passos numerados, valores esperados e pontos de registro.'),
      s('5 Segurança e contingências', 'Precauções, critérios de interrupção e tratamento de anomalias.'),
    ],
  },
  {
    id: 'TRP',
    title: 'Relatório de ensaio',
    english: 'Test report',
    source: 'ecssVerification',
    drd: 'ECSS-E-ST-10-02C Rev.1 · Anexo C (DRD)',
    reviews: {
      CDR: 'issue',
      QR: 'update',
      AR: 'update',
      ORR: 'update',
      FRR: 'update',
      LRR: 'update',
      CRR: 'update',
      ELR: 'update',
      MCR: 'final',
    },
    sections: [
      intro,
      docs(),
      terms(3),
      s(
        '4 Resultados do ensaio',
        'Resultados com dados de apoio (datas, procedimento como executado, resultados da instalação), análise e síntese.',
        'test-runs',
      ),
      s('5 Anomalias', 'Desvios ao procedimento, não conformidades, falhas e problemas.'),
      s(
        '6 Conclusões',
        'Requisitos verificados (conforme o documento de controle), conformidade ou desvio e comparação com os requisitos.',
      ),
    ],
  },
  {
    id: 'RES',
    code: 'VR',
    title: 'Relatório de verificação',
    english: 'Verification report',
    source: 'ecssVerification',
    drd: 'ECSS-E-ST-10-02C Rev.1 · Anexo F (DRD)',
    reviews: {
      CDR: 'issue',
      QR: 'update',
      AR: 'update',
      ORR: 'update',
      FRR: 'update',
      LRR: 'update',
      CRR: 'update',
      ELR: 'update',
      MCR: 'final',
    },
    sections: [
      intro,
      docs(),
      terms(3),
      s(
        '4 Resultados da verificação',
        'Abordagem, problemas e resultados, com referência aos relatórios de ensaio, análise, revisão de projeto e inspeção; desvios ao plano.',
        'test-runs',
      ),
      s(
        '5 Conclusões',
        'Requisitos a verificar, resultados, julgamento de encerramento e questões em aberto.',
        'verification-status',
      ),
    ],
  },
  {
    id: 'PUM',
    title: 'Manual do usuário do produto',
    english: 'Product user manual',
    source: 'ecssEngineering',
    drd: 'ECSS-E-ST-10C Rev.1 · Anexo P (DRD)',
    reviews: {
      CDR: 'issue',
      QR: 'update',
      AR: 'update',
      ORR: 'update',
      FRR: 'update',
      LRR: 'update',
      CRR: 'update',
      ELR: 'update',
      MCR: 'final',
    },
    sections: [
      intro,
      docs(),
      s(
        '3 Definição das funções do produto',
        'Funções esperadas, restrições funcionais e fases da vida: manuseio, armazenamento, instalação, operação nominal e de contingência, manutenção e descarte.',
      ),
      s(
        '4 Descrição do produto',
        'Resumo do projeto e diagrama de blocos, autonomia e FDIR, configurações, orçamentos por constituinte ou modo e referência ao ICD vigente.',
        'architecture',
      ),
      s('5 Operação', 'Modos, procedimentos nominais e de contingência e limites operacionais.'),
    ],
  },
  {
    id: 'SDM',
    title: 'Plano de mitigação de detritos espaciais',
    english: 'Space debris mitigation plan',
    source: 'ecssDebris',
    drd: 'ECSS-U-AS-10C Rev.2 (adoção da ISO 24113:2023)',
    reviews: {
      MDR: 'issue',
      PRR: 'update',
      SRR: 'update',
      PDR: 'update',
      CDR: 'update',
      QR: 'update',
      AR: 'update',
      ORR: 'update',
      FRR: 'update',
      LRR: 'update',
      ELR: 'update',
      MCR: 'final',
    },
    sections: [
      intro,
      docs('Registre a edição adotada e os limites que ela impõe; este modelo não fixa valores.'),
      s('3 Objetos liberados em operação', 'Objetos que o sistema libera e justificativa de cada um.'),
      s('4 Prevenção de fragmentação', 'Passivação ao fim da vida e prevenção de rupturas acidentais ou intencionais.'),
      s(
        '5 Descarte ao fim da vida',
        'Estratégia de descarte, proteção das regiões orbitais e probabilidade de sucesso exigida.',
      ),
      s('6 Risco de colisão e reentrada', 'Avaliação de colisão em órbita e de risco em solo na reentrada.'),
      s('7 Conformidade', 'Matriz de conformidade com os requisitos da edição adotada.'),
    ],
  },
];

const nasa = [
  {
    id: 'NEC',
    title: 'Expectativas das partes interessadas',
    english: 'Stakeholder identification and expectations',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.a(1)',
    reviews: { MCR: 'baseline', SRR: 'update' },
    sections: [
      s('1 Propósito', 'Por que o documento existe e qual revisão ele apoia.', 'purpose'),
      s('2 Partes interessadas', 'Quem tem interesse no resultado e qual a expectativa de cada um.', 'stakeholders'),
      s('3 Necessidades, metas e objetivos', 'Necessidades, metas e objetivos (NGOs) que orientam o conceito.'),
      s(
        '4 Premissas e restrições',
        'Restrições técnicas, de custo, prazo e normas impostas pelas partes interessadas.',
      ),
    ],
  },
  {
    id: 'CON',
    code: 'CONOPS',
    title: 'Conceito de operações',
    english: 'Concept of operations',
    source: 'nasaHandbook',
    drd: 'Handbook Apêndice S · NPR 7123.1D 5.2.2.2.a(2)',
    reviews: { MCR: 'baseline', SRR: 'update', 'MDR-SDR': 'update', PDR: 'update' },
    sections: [
      s(
        '1 Introdução',
        'Descrição do projeto (contexto, premissas e restrições) e visão geral e escopo do sistema pretendido.',
        'purpose',
      ),
      s('2 Documentos', 'Documentos aplicáveis e de referência.', 'references'),
      s(
        '3 Descrição do sistema pretendido',
        'Necessidades, metas e objetivos; visão geral e elementos-chave; interfaces; modos de operação; capacidades propostas.',
        'architecture',
      ),
      s('4 Ambiente físico', 'Ambiente em que o sistema opera.'),
      s('5 Ambiente de apoio', 'Instalações, logística, manutenção e apoio à operação.'),
      s('6 Cenários operacionais', 'Cenários e casos de uso em condições nominais e fora do nominal.'),
      s('7 Impactos', 'Impactos ambientais, organizacionais e científicos ou técnicos.'),
      s('8 Riscos e questões em aberto', 'Riscos e questões que o conceito ainda precisa resolver.'),
    ],
  },
  {
    id: 'MOE',
    title: 'Medidas de eficácia e critérios de sucesso',
    english: 'Measures of effectiveness',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.a(3)',
    reviews: { MCR: 'approve' },
    sections: [
      s('1 Objetivos da missão', 'Objetivos aos quais as medidas se referem.', 'purpose'),
      s(
        '2 Medidas de eficácia',
        'Cada medida, o objetivo que mede e o critério de sucesso, sem valores ainda não acordados.',
        'moe',
      ),
      s('3 Critérios de sucesso mínimo e pleno', 'O que caracteriza sucesso mínimo e sucesso pleno da missão.'),
      s('4 Relação com medidas de desempenho', 'Como as medidas se desdobram em MOPs e TPMs.'),
    ],
  },
  {
    id: 'SEMP',
    title: 'Plano de gerenciamento da engenharia de sistemas',
    english: 'Systems engineering management plan',
    source: 'nasaHandbook',
    drd: 'Handbook Apêndice J · NPR 7123.1D 5.2.2.2.b(1)',
    reviews: { MCR: 'preliminary', SRR: 'baseline', 'MDR-SDR': 'update', PDR: 'update', CDR: 'update' },
    sections: [
      s('1 Propósito e escopo', 'Para que serve o plano e o que ele cobre.', 'purpose'),
      s('2 Documentos aplicáveis', 'Documentos que o plano segue ou chama.', 'references'),
      s(
        '3 Resumo técnico',
        'Descrição e estrutura do sistema, integração do produto, contexto de planejamento, fronteira do esforço técnico e referências cruzadas.',
        'architecture',
      ),
      s(
        '### 3.4 Contexto de planejamento',
        'Ciclo de vida, marcos e revisões que enquadram o esforço técnico.',
        'lifecycle',
      ),
      s(
        '4 Integração do esforço técnico',
        'Responsabilidade e autoridade, integração com contratadas e ferramentas analíticas.',
        'organization',
      ),
      s('5 Implementação dos processos técnicos comuns', 'Como cada processo do NPR 7123.1 será aplicado no projeto.'),
      s('6 Inserção de tecnologia', 'Como e quando novas tecnologias entram no projeto e sua relação com P&D.'),
      s(
        '7 Funções e atividades adicionais',
        'Segurança do sistema, métodos e ferramentas, engenharia de especialidades, medidas técnicas de desempenho e herança.',
      ),
      s('8 Integração com o plano do projeto', 'Relação com o plano do projeto e alocação de recursos técnicos.'),
      s('9 Matrizes de conformidade', 'Conformidade com os requisitos do NPR 7123.1 aplicáveis ao projeto.'),
    ],
  },
  {
    id: 'REQ',
    code: 'SRD',
    title: 'Documento de requisitos do sistema',
    english: 'System requirements document',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.b(2); Handbook Apêndice C',
    reviews: { MCR: 'preliminary', SRR: 'baseline', 'MDR-SDR': 'update', PDR: 'update', CDR: 'update' },
    sections: [
      s('1 Escopo', 'Sistema coberto e limites do documento.', 'purpose'),
      s('2 Documentos aplicáveis', 'Documentos de onde os requisitos derivam.', 'references'),
      s(
        '3 Requisitos',
        'Um "deve" por enunciado, verificável, com justificativa e rastreável à origem (checklist do Apêndice C).',
        'requirements',
      ),
      s('4 Disposições de verificação', 'Método de verificação de cada requisito.', 'method-allocation'),
      s('5 Rastreabilidade', 'Origem e requisito superior de cada requisito.', 'traceability'),
      s('6 Itens TBD/TBR', 'Valores ainda não definidos e o plano para fechá-los.', 'tbd'),
    ],
  },
  {
    id: 'HSI',
    title: 'Plano de integração humana do sistema',
    english: 'Human systems integration plan',
    source: 'nasaHandbook',
    drd: 'Handbook Apêndice R · NPR 7123.1D 5.2.2.2.b(3)',
    reviews: { SRR: 'baseline', 'MDR-SDR': 'update', PDR: 'update', CDR: 'update' },
    sections: [
      s('1 Introdução', 'Propósito, escopo e definições.', 'purpose'),
      s('2 Documentos aplicáveis', 'Documentos de HSI aplicáveis.', 'references'),
      s('3 Objetivos de HSI', 'Descrição do sistema e relevância da integração humana.'),
      s('4 Estratégia de HSI', 'Resumo da estratégia e domínios de HSI envolvidos.'),
      s(
        '5 Implementação',
        'Requisitos de HSI, organização, papéis e responsabilidades e tratamento de questões e riscos.',
        'organization',
      ),
    ],
  },
  {
    id: 'TDP',
    title: 'Plano de desenvolvimento tecnológico',
    english: 'Technology development plan',
    source: 'nasaCriteria',
    drd: 'NPR 7123.1D Apêndice G; Handbook Apêndice G',
    reviews: { MCR: 'baseline', SRR: 'update', 'MDR-SDR': 'update', PDR: 'update', CDR: 'update' },
    sections: [
      s('1 Propósito', 'Tecnologias críticas e como serão amadurecidas.', 'purpose'),
      s(
        '2 Avaliação de prontidão tecnológica',
        'TRL atual de cada tecnologia crítica, evidência e TRL necessário em cada revisão.',
        'trsl',
      ),
      s('3 Plano de amadurecimento', 'Atividades, marcos e critérios para atingir o TRL necessário.'),
      s('4 Alternativas e riscos', 'Alternativas de reserva e riscos associados.'),
    ],
  },
  {
    id: 'RMP',
    title: 'Plano de gerenciamento de riscos',
    english: 'Risk management plan',
    source: 'nasaCriteria',
    drd: 'NPR 7123.1D Apêndice G · critérios de entrada da SRR',
    reviews: { SRR: 'baseline', 'MDR-SDR': 'update' },
    sections: [
      s('1 Propósito e escopo', 'Como o projeto identifica, analisa e trata riscos.', 'purpose'),
      s('2 Organização e responsabilidades', 'Quem identifica, analisa, decide e acompanha os riscos.', 'organization'),
      s(
        '3 Processo',
        'Identificação, análise (probabilidade e consequência), planejamento de resposta, acompanhamento e controle.',
      ),
      s('4 Registro de riscos', 'Riscos atuais com responsável, classificação e plano de resposta.'),
    ],
  },
  {
    id: 'CMP',
    title: 'Plano de gerenciamento de configuração',
    english: 'Configuration management plan',
    source: 'nasaHandbook',
    drd: 'Handbook Apêndice M; NPR 7123.1D Apêndice G (SRR)',
    reviews: { SRR: 'baseline', PDR: 'update' },
    sections: [
      s('1 Propósito e escopo', 'Itens sob controle de configuração e limites do plano.', 'purpose'),
      s('2 Organização', 'Responsáveis e comitê de controle de configuração.', 'organization'),
      s('3 Identificação da configuração', 'Itens de configuração, linhas de base e identificação.', 'products'),
      s('4 Controle de mudanças', 'Pedido, avaliação, aprovação e implementação de mudanças.'),
      s('5 Contabilidade da situação e auditorias', 'Registro da situação da configuração e auditorias.'),
    ],
  },
  {
    id: 'ARQ',
    title: 'Arquitetura e alocação de requisitos',
    english: 'Architecture definition and allocation',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.c(2–3)',
    reviews: { 'MDR-SDR': 'baseline', PDR: 'update' },
    sections: [
      s('1 Propósito', 'Arquitetura do sistema e alocação dos requisitos ao nível inferior.', 'purpose'),
      s('2 Arquitetura do sistema', 'Elementos, estrutura e interfaces da arquitetura.', 'architecture'),
      s('3 Alocação de requisitos', 'Requisito do sistema → elemento ou subsistema responsável.', 'allocation'),
      s('4 Alternativas consideradas', 'Alternativas avaliadas e razão da escolha.'),
    ],
  },
  {
    id: 'TPM',
    title: 'Medidas técnicas de desempenho e indicadores',
    english: 'Technical performance measures',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.c(1,4)',
    reviews: { 'MDR-SDR': 'approve', PDR: 'update', CDR: 'update' },
    sections: [
      s('1 Propósito', 'Parâmetros acompanhados para medir o progresso técnico.', 'purpose'),
      s(
        '2 Medidas técnicas de desempenho',
        'Parâmetro, requisito de origem, valor exigido, margem planejada, estimativa atual e tendência.',
        'budget',
      ),
      s('3 Indicadores de progresso', 'Indicadores exigidos e frequência de relato.'),
    ],
  },
  {
    id: 'IRD',
    title: 'Documento de requisitos de interface',
    english: 'Interface requirements document',
    source: 'nasaHandbook',
    drd: 'Handbook Apêndice L',
    reviews: { SRR: 'preliminary', 'MDR-SDR': 'update', PDR: 'baseline', CDR: 'update' },
    sections: [
      s('1 Introdução', 'Propósito e escopo, precedência e responsabilidade e autoridade de mudança.', 'purpose'),
      s('2 Documentos', 'Documentos aplicáveis e de referência.', 'references'),
      s(
        '3 Interfaces',
        'Descrição e responsabilidades das interfaces, sistemas de coordenadas e requisitos por tipo: propriedades de massa, estrutural/mecânica, fluidos, elétrica, sinal, software e dados, ambientes.',
        'interfaces',
      ),
    ],
  },
  {
    id: 'PRE',
    title: 'Definição do projeto preliminar',
    english: 'Preliminary design definition',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.d(1)',
    reviews: { PDR: 'preliminary' },
    sections: [
      s('1 Propósito', 'Solução preliminar que atende aos requisitos alocados.', 'purpose'),
      s('2 Solução de projeto', 'Descrição do projeto por elemento.', 'architecture'),
      s(
        '3 Atendimento aos requisitos',
        'Como a solução atende a cada requisito e as margens atuais.',
        'requirement-summary',
      ),
      s('4 Riscos e questões em aberto', 'Riscos e decisões pendentes antes da CDR.'),
    ],
  },
  {
    id: 'DET',
    title: 'Definição do projeto detalhado',
    english: 'Detailed design definition',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.e',
    reviews: { CDR: 'baseline', PRR: 'update', SIR: 'update' },
    sections: [
      s('1 Propósito', 'Projeto detalhado ("build-to") sob controle de configuração.', 'purpose'),
      s(
        '2 Projeto detalhado',
        'Especificações de fabricação, desenhos e pacote de dados técnicos por elemento.',
        'architecture',
      ),
      s('3 Atendimento aos requisitos', 'Situação de cada requisito e margens.', 'requirement-summary'),
      s('4 Planos de fabricação, integração e ensaio', 'Referência aos planos que acompanham o projeto detalhado.'),
    ],
  },
  {
    id: 'INT',
    title: 'Plano de integração',
    english: 'Integration plan',
    source: 'nasaHandbook',
    drd: 'Handbook Apêndice H · NPR 7123.1D 5.2.2.2.d(2) e f(1)',
    reviews: { PDR: 'preliminary', CDR: 'update', PRR: 'update', SIR: 'baseline' },
    sections: [
      s('1 Propósito do documento', 'O que o plano cobre.', 'purpose'),
      s('2 Escopo do projeto', 'Elementos e níveis a integrar.', 'products'),
      s('3 Estratégia de integração', 'Sequência, configurações intermediárias e critérios de cada etapa.'),
      s('4 Etapas de integração', 'Etapas, ensaios de integração, instalações e equipamentos de apoio.'),
    ],
  },
  {
    id: 'VVP',
    title: 'Plano de verificação e validação',
    english: 'Verification and validation plan',
    source: 'nasaHandbook',
    drd: 'Handbook Apêndice I · NPR 7123.1D 5.2.2.2.d(3)',
    reviews: { 'MDR-SDR': 'preliminary', PDR: 'baseline', CDR: 'update', SIR: 'update', TRR: 'update' },
    sections: [
      s('1 Introdução', 'Propósito e escopo, responsabilidade e autoridade de mudança, definições.', 'purpose'),
      s(
        '2 Documentos aplicáveis e de referência',
        'Documentos aplicáveis, de referência e ordem de precedência.',
        'references',
      ),
      s(
        '3 Descrição do sistema',
        'Desdobramento dos requisitos, arquitetura do sistema e dos itens finais, equipamento de apoio em solo.',
        'architecture',
      ),
      s(
        '4 Processo de verificação e validação',
        'Responsabilidades, métodos de verificação (análise, inspeção, demonstração, ensaio), métodos de validação, certificação e ensaios de aceitação.',
        'method-allocation',
      ),
      s('5 Implementação', 'Fluxo de projeto e V&V, artigos de ensaio, equipamentos e instalações.'),
      s(
        '6 V&V dos itens finais',
        'Avaliações de unidades de desenvolvimento, atividades de verificação e validação e aceitação por item.',
        'verification-activities',
      ),
      s('7 V&V do sistema', 'Integração dos itens finais e do sistema completo.'),
      s('8 V&V do programa', 'Integração ao veículo, ensaios fim a fim e V&V em órbita.'),
      s('9 Produtos de certificação', 'Produtos que comprovam a certificação do sistema.'),
    ],
  },
  {
    id: 'VCD',
    code: 'RVM',
    title: 'Matriz de verificação de requisitos',
    english: 'Requirements verification matrix',
    source: 'nasaHandbook',
    drd: 'Handbook Apêndice D',
    reviews: { SRR: 'preliminary', PDR: 'update', CDR: 'update', TRR: 'update', SAR: 'final' },
    sections: [
      s('1 Propósito', 'Como cada requisito "deve" será verificado e onde está seu resultado.', 'purpose'),
      s(
        '2 Matriz de verificação',
        'Requisito, documento de origem, enunciado, critério de sucesso, método, instalação, fase, organização executora e resultado.',
        'rvm',
      ),
    ],
  },
  {
    id: 'RTM',
    title: 'Matriz de rastreabilidade',
    english: 'Traceability matrix',
    source: 'nasaHandbook',
    drd: 'Handbook 6.2 · Gerenciamento de requisitos',
    reviews: { SRR: 'baseline', 'MDR-SDR': 'update', PDR: 'update', CDR: 'update' },
    sections: [
      s('1 Propósito', 'Ligação de cada requisito à origem, ao nível superior e à verificação.', 'purpose'),
      s('2 Matriz', 'Requisito, origem, método e verificações.', 'traceability'),
    ],
  },
  {
    id: 'RES',
    title: 'Resultados de verificação e validação',
    english: 'Verification and validation results',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.f(2) e g(1)',
    reviews: {
      SIR: 'initial',
      TRR: 'update',
      SAR: 'update',
      ORR: 'update',
      FRR: 'final',
      PLAR: 'update',
      PFAR: 'update',
    },
    sections: [
      s('1 Propósito', 'Resultados disponíveis nesta revisão.', 'purpose'),
      s('2 Resultados registrados', 'Execuções registradas com resultado e evidência.', 'test-runs'),
      s(
        '3 Situação por requisito',
        'Requisitos verificados, pendentes e sem verificação planejada.',
        'verification-status',
      ),
      s('4 Discrepâncias e ações', 'Discrepâncias abertas e ações de encerramento.'),
    ],
  },
  {
    id: 'OPS',
    title: 'Planos de operação',
    english: 'Operations plans',
    source: 'nasaCriteria',
    drd: 'NPR 7123.1D Apêndice G',
    reviews: { SIR: 'preliminary', ORR: 'baseline', FRR: 'update', PLAR: 'update', CERR: 'update' },
    sections: [
      s('1 Propósito', 'Operações cobertas.', 'purpose'),
      s('2 Organização da operação', 'Equipe, turnos e responsabilidades.', 'organization'),
      s('3 Procedimentos', 'Procedimentos nominais e de contingência.'),
      s('4 Prontidão', 'Treinamento, simulações e critérios de prontidão.'),
    ],
  },
  {
    id: 'DES',
    title: 'Plano de descomissionamento',
    english: 'Decommissioning plan',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.g(2)',
    reviews: { ORR: 'baseline', DR: 'final' },
    sections: [
      s('1 Propósito', 'Encerramento das operações do sistema.', 'purpose'),
      s('2 Critérios e sequência', 'Critérios para iniciar o descomissionamento e sequência de atividades.'),
      s('3 Dados e registros', 'Preservação de dados e lições aprendidas.'),
    ],
  },
  {
    id: 'DSP',
    title: 'Plano de descarte',
    english: 'Disposal plan',
    source: 'nasaProcess',
    drd: 'NPR 7123.1D · 5.2.2.2.g(3)',
    reviews: { PDR: 'preliminary', ORR: 'baseline', DRR: 'final' },
    sections: [
      s('1 Propósito', 'Descarte do sistema ao fim da vida.', 'purpose'),
      s(
        '2 Estratégia de descarte',
        'Método, prazos e requisitos de detritos aplicáveis, sem valores ainda não confirmados.',
      ),
      s('3 Riscos', 'Riscos do descarte e sua mitigação.'),
    ],
  },
];

// Projects with their own lifecycle use a short, generic set.
const custom = [
  {
    id: 'REQ',
    code: 'ESP',
    title: 'Especificação de requisitos',
    english: 'Requirements specification',
    source: '',
    drd: 'Modelo da equipe',
    reviews: { '': 'issue' },
    sections: [
      s('1 Escopo', 'Produto coberto e limites.', 'purpose'),
      s('2 Requisitos', 'Um requisito por enunciado, com critério e método.', 'requirements'),
      s('3 Rastreabilidade', 'Origem de cada requisito.', 'traceability'),
    ],
  },
  {
    id: 'VVP',
    code: 'PV',
    title: 'Plano de verificação',
    english: 'Verification plan',
    source: '',
    drd: 'Modelo da equipe',
    reviews: { '': 'issue' },
    sections: [
      s('1 Escopo', 'O que será verificado.', 'purpose'),
      s('2 Métodos por requisito', 'Método de cada requisito.', 'method-allocation'),
      s('3 Atividades', 'Atividades planejadas.', 'verification-activities'),
    ],
  },
  {
    id: 'RTM',
    title: 'Matriz de rastreabilidade',
    english: 'Traceability matrix',
    source: '',
    drd: 'Modelo da equipe',
    reviews: { '': 'issue' },
    sections: [s('1 Matriz', 'Requisito, origem, método e verificações.', 'traceability')],
  },
];

export const DOCUMENT_TEMPLATES = { ecss, nasa, custom };

/** The data package proposed for one review. A review the team created without a standard code may use any template of its profile. */
export function documentPackage(profile, code = '') {
  const catalog = DOCUMENT_TEMPLATES[profile];
  if (!catalog) return [];
  const custom = profile === 'custom';
  return catalog.flatMap(template => {
    const maturity = custom ? 'issue' : template.reviews[code] || '';
    if (code && !custom && !maturity) return [];
    const source = TEMPLATE_SOURCES[template.source];
    return [
      {
        id: template.id,
        code: template.code || template.id,
        title: (code && template.titles?.[code]) || template.title,
        english: template.english,
        kind: custom ? 'company' : 'norm',
        flow: 'input',
        profile,
        maturity: maturity ? MATURITY_LABELS[maturity] : '',
        maturityKey: maturity,
        reference: source
          ? { title: source.title, edition: source.edition, url: source.url, section: template.drd, org: source.org }
          : null,
        sections: template.sections.map(section => section.heading.replace(/^#+\s*/, '')),
      },
    ];
  });
}

/** Full template (with section guidance) for drafting. */
export function documentTemplate(profile, id) {
  return DOCUMENT_TEMPLATES[profile]?.find(template => template.id === id) || null;
}
