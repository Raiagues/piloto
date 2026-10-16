// Public reference metadata adapted from Raiagues/testes_requisitos, commit 692739d7.
// Selection is optional. Titles, editions and cited products are references, not an assessment of applicability.
export const DELIVERY_STANDARD_GROUPS = [
  {
    "id": "ecss",
    "name": "ECSS",
    "icon": "layers",
    "tagline": "Engenharia, verificação e revisões"
  },
  {
    "id": "guides",
    "name": "NASA e INCOSE",
    "icon": "compass",
    "tagline": "Processos, requisitos e entregas"
  },
  {
    "id": "iso",
    "name": "ISO",
    "icon": "grid",
    "tagline": "Sistemas, qualidade e segurança"
  },
  {
    "id": "brasil",
    "name": "Brasil",
    "icon": "globe",
    "tagline": "Atividades espaciais e Anatel"
  },
  {
    "id": "communications",
    "name": "Comunicações",
    "icon": "signal",
    "tagline": "Espectro e interfaces espaciais"
  },
  {
    "id": "control",
    "name": "Dados e exportação",
    "icon": "shield",
    "tagline": "Acesso, transferência e uso final"
  }
];
export const DELIVERY_STANDARDS = [
  {
    "id": "ecss-req",
    "group": "ecss",
    "title": "ECSS-E-ST-10-06C",
    "edition": "2009",
    "subtitle": "Especificação de requisitos",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standard/ecss-e-st-10-06c-technical-requirements-specification/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Especificação de requisitos técnicos",
        "basis": "Anexo A · Technical requirements specification",
        "status": "required"
      }
    ],
    "extras": [
      "Glossário do projeto",
      "Registro de justificativas",
      "Checklist de redação"
    ],
    "note": "O anexo define o conteúdo da especificação. Os complementos são propostas de organização da equipe.",
    "tags": [
      "Requisitos",
      "Rastreabilidade"
    ],
    "name": "ECSS-E-ST-10-06C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-se",
    "group": "ecss",
    "title": "ECSS-E-ST-10C",
    "edition": "Rev. 1 · 2017",
    "subtitle": "Engenharia de sistemas",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standard/ecss-e-st-10c-rev-1-system-engineering-general-requirements-15-february-2017/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Plano de engenharia de sistemas",
        "basis": "Anexo D · SEP",
        "status": "required"
      },
      {
        "title": "Descrição da missão",
        "basis": "Anexo B · MDD",
        "status": "required"
      },
      {
        "title": "Arquivo de definição do projeto",
        "basis": "Anexo G · DDF",
        "status": "required"
      },
      {
        "title": "Matriz de rastreabilidade",
        "basis": "Anexo N · RTM",
        "status": "required"
      }
    ],
    "extras": [
      "Mapa de responsáveis",
      "Painel de pendências"
    ],
    "note": "Seleção de quatro entregas. A cláusula 7 e os demais anexos precisam ser considerados na definição completa do contrato.",
    "tags": [
      "Missão",
      "Planejamento"
    ],
    "name": "ECSS-E-ST-10C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-ver",
    "group": "ecss",
    "title": "ECSS-E-ST-10-02C",
    "edition": "Rev. 1 · 2018",
    "subtitle": "Verificação",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standard/ecss-e-st-10-02c-rev-1-verification-1-february-2018/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Plano de verificação",
        "basis": "Anexo A",
        "status": "required"
      },
      {
        "title": "Documento de controle da verificação",
        "basis": "Anexo B · VCD",
        "status": "required"
      },
      {
        "title": "Relatório de ensaio",
        "basis": "Anexo C · quando houver ensaios",
        "status": "required"
      },
      {
        "title": "Relatório de revisão de projeto",
        "basis": "Anexo D · quando esse método for adotado",
        "status": "required"
      }
    ],
    "extras": [
      "Painel de cobertura dos requisitos",
      "Lista de evidências pendentes"
    ],
    "note": "Software e ensaios também têm normas específicas. Os documentos dependem dos métodos de verificação adotados.",
    "tags": [
      "Ensaios",
      "Evidências"
    ],
    "name": "ECSS-E-ST-10-02C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-reviews",
    "group": "ecss",
    "title": "ECSS-M-ST-10-01C",
    "edition": "2008",
    "subtitle": "Organização das revisões",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standard/ecss-m-st-10-01c-organization-and-conduct-of-reviews/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Pacote documental da revisão",
        "basis": "Definir conforme o marco e a matriz de aplicabilidade",
        "status": "confirm"
      },
      {
        "title": "Registro de resultados da revisão",
        "basis": "Conferir conteúdo e responsáveis no escopo contratado",
        "status": "confirm"
      }
    ],
    "extras": [
      "Agenda de SRR, PDR e CDR",
      "Lista de ações e responsáveis"
    ],
    "note": "Não existe um calendário universal. Datas, revisões e documentos de entrada são definidos para cada projeto.",
    "tags": [
      "SRR",
      "PDR",
      "CDR"
    ],
    "name": "ECSS-M-ST-10-01C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-test",
    "group": "ecss",
    "title": "ECSS-E-ST-10-03C",
    "edition": "Rev. 1 · 2022",
    "subtitle": "Ensaios",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standards/active-standards/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Documentação de ensaios",
        "basis": "Identificar procedimentos e registros pela edição adotada",
        "status": "confirm"
      }
    ],
    "extras": [
      "Agenda de bancada",
      "Checklist de prontidão"
    ],
    "note": "O catálogo identifica a referência. O mapeamento integral dos documentos ainda precisa da leitura do texto aplicável.",
    "tags": [
      "Ensaios"
    ],
    "name": "ECSS-E-ST-10-03C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-interface",
    "group": "ecss",
    "title": "ECSS-E-ST-10-24C",
    "edition": "Rev. 1 · 2024",
    "subtitle": "Gestão de interfaces",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standards/active-standards/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Documentação de interfaces",
        "basis": "Conteúdo e formato a confirmar na edição contratual",
        "status": "confirm"
      }
    ],
    "extras": [
      "Mapa visual de interfaces",
      "Registro de pendências entre equipes"
    ],
    "note": "",
    "tags": [
      "Interfaces"
    ],
    "name": "ECSS-E-ST-10-24C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-software",
    "group": "ecss",
    "title": "ECSS-E-ST-40C",
    "edition": "Rev. 1 · 2025",
    "subtitle": "Software espacial",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standards/active-standards/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Conjunto de documentos de software",
        "basis": "Determinar pelos processos adotados e pelas definições documentais",
        "status": "confirm"
      }
    ],
    "extras": [
      "Mapa de mudanças de requisitos",
      "Checklist de entrega de software"
    ],
    "note": "Combinar com ECSS-Q-ST-80 quando a garantia de produto de software fizer parte do escopo.",
    "tags": [
      "Software"
    ],
    "name": "ECSS-E-ST-40C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-pa",
    "group": "ecss",
    "title": "ECSS-Q-ST-10C",
    "edition": "Rev. 1 · 2016",
    "subtitle": "Garantia de produto",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standards/active-standards/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Documentação de garantia de produto",
        "basis": "Confirmar os itens aplicáveis ao fornecimento",
        "status": "confirm"
      }
    ],
    "extras": [
      "Painel de não conformidades",
      "Mapa de evidências de fornecedores"
    ],
    "note": "",
    "tags": [
      "Qualidade"
    ],
    "name": "ECSS-Q-ST-10C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-safety",
    "group": "ecss",
    "title": "ECSS-Q-ST-40C",
    "edition": "Rev. 1 · 2017",
    "subtitle": "Segurança do produto",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standards/active-standards/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Registros e análises de segurança",
        "basis": "Determinar conforme a missão e o contrato",
        "status": "confirm"
      }
    ],
    "extras": [
      "Registro de perigos",
      "Lista de decisões de segurança"
    ],
    "note": "Um requisito isolado não permite concluir que o sistema é seguro.",
    "tags": [
      "Segurança"
    ],
    "name": "ECSS-Q-ST-40C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-config",
    "group": "ecss",
    "title": "ECSS-M-ST-40C",
    "edition": "Rev. 1 · 2009",
    "subtitle": "Configuração e informação",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standards/active-standards/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Documentação de configuração",
        "basis": "Definir itens, versões e registros pela norma adotada",
        "status": "confirm"
      }
    ],
    "extras": [
      "Histórico visual de versões",
      "Registro de mudanças"
    ],
    "note": "",
    "tags": [
      "Versões"
    ],
    "name": "ECSS-M-ST-40C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "nasa-hb",
    "group": "guides",
    "title": "NASA Systems Engineering Handbook",
    "edition": "SP-2016-6105 · Rev. 2",
    "subtitle": "Redação e verificação de requisitos",
    "kind": "Guia",
    "url": "https://www.nasa.gov/reference/appendix-c-how-to-write-a-good-requirement/",
    "scope": "Guia de engenharia. Não cria, por si só, uma obrigação legal ou contratual para um projeto brasileiro.",
    "docs": [
      {
        "title": "Matriz de verificação de requisitos",
        "basis": "Apêndice D · modelo orientativo",
        "status": "guide"
      },
      {
        "title": "Plano de engenharia de sistemas",
        "basis": "Apêndice J · conteúdo orientativo",
        "status": "guide"
      },
      {
        "title": "Plano de verificação e validação",
        "basis": "Apêndice I · conteúdo orientativo",
        "status": "guide"
      }
    ],
    "extras": [
      "Checklist de qualidade dos requisitos",
      "Registro de decisões da equipe"
    ],
    "note": "A redação, a rastreabilidade e a possibilidade de verificação são tratadas no Apêndice C.",
    "tags": [
      "Requisitos",
      "Verificação"
    ],
    "name": "NASA Systems Engineering Handbook",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "nasa-npr",
    "group": "guides",
    "title": "NASA NPR 7123.1D",
    "edition": "Change 2 · vigente na consulta",
    "subtitle": "Processos e revisões técnicas",
    "kind": "Diretriz institucional",
    "url": "https://nodis3.gsfc.nasa.gov/displayDir.cfm?t=NPR&c=7123&s=1D",
    "scope": "Aplica-se no âmbito definido pela NASA e quando incorporada ao contrato. A aplicabilidade deve ser confirmada pelo responsável do projeto.",
    "docs": [
      {
        "title": "Plano de engenharia de sistemas",
        "basis": "Capítulo 6 · SEMP",
        "status": "required"
      },
      {
        "title": "Matriz de conformidade",
        "basis": "Apêndice H",
        "status": "required"
      },
      {
        "title": "Evidências de entrada nas revisões",
        "basis": "Apêndice G · conforme o marco adotado",
        "status": "required"
      }
    ],
    "extras": [
      "Cronograma visual de revisões",
      "Mapa de responsáveis"
    ],
    "note": "Revisões como SRR, PDR e CDR têm critérios. O calendário da missão não é fixado pelo catálogo.",
    "tags": [
      "Processos",
      "Revisões"
    ],
    "name": "NASA NPR 7123.1D",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "incose",
    "group": "guides",
    "title": "INCOSE Systems Engineering Handbook",
    "edition": "Edição adotada pela equipe",
    "subtitle": "Processos ao longo do ciclo de vida",
    "kind": "Guia",
    "url": "https://www.incose.org/resources-publications/technical-publications/se-handbook/",
    "scope": "Referência de processos. As entregas devem ser escolhidas com base no projeto, no contrato e no texto licenciado.",
    "docs": [],
    "extras": [
      "Mapa de processos",
      "Plano de engenharia",
      "Registro de interessados",
      "Matriz de responsabilidades"
    ],
    "note": "O manual integral não está incluído. Estes complementos são modelos da Norte, não documentos obrigatórios atribuídos ao INCOSE.",
    "tags": [
      "Ciclo de vida"
    ],
    "name": "INCOSE Systems Engineering Handbook",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "iso-29148",
    "group": "iso",
    "title": "ISO/IEC/IEEE 29148",
    "edition": "2018",
    "subtitle": "Engenharia de requisitos",
    "kind": "Norma técnica",
    "url": "https://www.iso.org/standard/72089.html",
    "scope": "Confirmar a edição e o escopo contratado no texto licenciado. A ficha pública da ISO não é suficiente para uma lista completa de obrigações documentais.",
    "docs": [
      {
        "title": "Informações de requisitos exigidas",
        "basis": "Itens e conteúdo a confirmar no texto integral",
        "status": "confirm"
      }
    ],
    "extras": [
      "Especificação de requisitos do sistema",
      "Registro de necessidades",
      "Matriz de rastreabilidade"
    ],
    "note": "Os complementos são estruturas propostas pela Norte. Não reproduzem o texto da norma.",
    "tags": [
      "Requisitos"
    ],
    "name": "ISO/IEC/IEEE 29148",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "iso-15288",
    "group": "iso",
    "title": "ISO/IEC/IEEE 15288",
    "edition": "2023",
    "subtitle": "Processos do ciclo de vida",
    "kind": "Norma técnica",
    "url": "https://www.iso.org/standard/81702.html",
    "scope": "Confirmar a edição e o escopo contratado no texto licenciado. A ficha pública da ISO não é suficiente para uma lista completa de obrigações documentais.",
    "docs": [
      {
        "title": "Evidências dos processos adotados",
        "basis": "Identificar no escopo e no texto licenciado",
        "status": "confirm"
      }
    ],
    "extras": [
      "Plano de engenharia de sistemas",
      "Mapa do ciclo de vida"
    ],
    "note": "",
    "tags": [
      "Processos"
    ],
    "name": "ISO/IEC/IEEE 15288",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "iso-9001",
    "group": "iso",
    "title": "ISO 9001",
    "edition": "2026",
    "subtitle": "Gestão da qualidade",
    "kind": "Norma técnica",
    "url": "https://www.iso.org/standard/9001",
    "scope": "Confirmar a edição e o escopo contratado no texto licenciado. A ficha pública da ISO não é suficiente para uma lista completa de obrigações documentais.",
    "docs": [
      {
        "title": "Informação documentada do sistema de gestão",
        "basis": "Confirmar os itens da edição adotada e a transição aplicável",
        "status": "confirm"
      }
    ],
    "extras": [
      "Mapa de processos",
      "Registro de ações corretivas"
    ],
    "note": "A ISO apresenta a edição 2026 como sucessora da edição 2015. Contratos e certificações existentes exigem análise de transição.",
    "tags": [
      "Qualidade"
    ],
    "name": "ISO 9001",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "iso-27001",
    "group": "iso",
    "title": "ISO/IEC 27001",
    "edition": "2022 · Amd 1 de 2024",
    "subtitle": "Gestão de segurança da informação",
    "kind": "Norma técnica",
    "url": "https://www.iso.org/standard/27001",
    "scope": "Confirmar a edição e o escopo contratado no texto licenciado. A ficha pública da ISO não é suficiente para uma lista completa de obrigações documentais.",
    "docs": [
      {
        "title": "Documentação do sistema de segurança",
        "basis": "Confirmar os registros obrigatórios no texto licenciado",
        "status": "confirm"
      }
    ],
    "extras": [
      "Mapa de acesso aos documentos",
      "Inventário de informações"
    ],
    "note": "Selecionar hospedagem privada não equivale a certificação ISO nem resolve automaticamente controles de exportação.",
    "tags": [
      "Segurança",
      "Dados"
    ],
    "name": "ISO/IEC 27001",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "iso-24113",
    "group": "iso",
    "title": "ISO 24113",
    "edition": "2023",
    "subtitle": "Mitigação de detritos espaciais",
    "kind": "Norma técnica",
    "url": "https://www.iso.org/standard/83494.html",
    "scope": "Para sistemas espaciais não tripulados no escopo da norma, incluindo objetos e estágios orbitais. Confirmar sua adoção e a edição contratual.",
    "docs": [
      {
        "title": "Demonstração de atendimento aos requisitos de mitigação",
        "basis": "Conteúdo a confirmar no texto licenciado",
        "status": "confirm"
      }
    ],
    "extras": [
      "Registro de premissas de fim de missão",
      "Checklist de mitigação de detritos"
    ],
    "note": "",
    "tags": [
      "Ambiente orbital"
    ],
    "name": "ISO 24113",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "br-space",
    "group": "brasil",
    "title": "Lei 14.946",
    "edition": "2024",
    "subtitle": "Atividades espaciais no Brasil",
    "kind": "Lei",
    "url": "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14946.htm",
    "scope": "Atividades espaciais abrangidas pela lei. Um estudo conceitual não deve ser confundido com uma operação que já exige autorização.",
    "docs": [
      {
        "title": "Licença e autorização da atividade",
        "basis": "Art. 13 · conforme a atividade e a regulamentação",
        "status": "required"
      },
      {
        "title": "Autorização de voo",
        "basis": "Art. 14 · para lançamento ou reentrada",
        "status": "required"
      },
      {
        "title": "Garantias ou seguro",
        "basis": "Art. 15 · quando exigidos",
        "status": "required"
      },
      {
        "title": "Registros e informações da atividade",
        "basis": "Arts. 17, 20 e 25 · conforme o enquadramento",
        "status": "required"
      }
    ],
    "extras": [
      "Mapa de autorizações",
      "Cronograma de regularização"
    ],
    "note": "AEB, Comando da Aeronáutica e Anatel têm competências diferentes. É necessário verificar os atos complementares aplicáveis.",
    "tags": [
      "Brasil",
      "Operações"
    ],
    "name": "Lei 14.946",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "anatel-service",
    "group": "brasil",
    "title": "Anatel · Resolução 777",
    "edition": "2025 · texto consolidado",
    "subtitle": "Enquadramento dos serviços",
    "kind": "Regulamento",
    "url": "https://informacoes.anatel.gov.br/legislacao/resolucoes/2025/2022-resolucao-777",
    "scope": "A modalidade depende da finalidade do serviço. Radioamador não se destina a objetivos pecuniários ou comerciais.",
    "docs": [
      {
        "title": "Enquadramento e autorizações pertinentes",
        "basis": "RGST e regras específicas da modalidade · conferir dispensas",
        "status": "confirm"
      }
    ],
    "extras": [
      "Ficha de finalidade do enlace",
      "Mapa de responsabilidades de telecomunicações"
    ],
    "note": "O exemplo AUR-002 aponta conflito de finalidade com o art. 26 do anexo. Só a frequência, sem contexto, não determina o enquadramento.",
    "tags": [
      "Anatel",
      "Serviço"
    ],
    "name": "Anatel · Resolução 777",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "anatel-sat",
    "group": "brasil",
    "title": "Anatel · Resolução 748",
    "edition": "2021 · texto consolidado",
    "subtitle": "Exploração de satélites",
    "kind": "Regulamento",
    "url": "https://informacoes.anatel.gov.br/legislacao/resolucoes/2021/1595-resolucao-748",
    "scope": "Quando a exploração de satélite estiver abrangida pelo regulamento. Ler o texto consolidado e as alterações posteriores.",
    "docs": [
      {
        "title": "Documentação do direito de exploração",
        "basis": "Conferir o procedimento aplicável ao satélite e à operação",
        "status": "confirm"
      }
    ],
    "extras": [
      "Mapa de direitos e responsabilidades",
      "Registro de coordenação"
    ],
    "note": "",
    "tags": [
      "Anatel",
      "Satélites"
    ],
    "name": "Anatel · Resolução 748",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "lgpd",
    "group": "brasil",
    "title": "Lei Geral de Proteção de Dados",
    "edition": "Lei 13.709/2018 · consolidada",
    "subtitle": "Tratamento de dados pessoais",
    "kind": "Lei",
    "url": "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm",
    "scope": "Aplica-se ao tratamento de dados pessoais no escopo da lei. Dados técnicos sem informação pessoal têm outros controles.",
    "docs": [
      {
        "title": "Registro das operações de tratamento",
        "basis": "Art. 37",
        "status": "required"
      },
      {
        "title": "Relatório de impacto à proteção de dados",
        "basis": "Art. 38 · quando determinado pela autoridade",
        "status": "required"
      }
    ],
    "extras": [
      "Mapa de acesso e retenção",
      "Aviso de privacidade do serviço"
    ],
    "note": "",
    "tags": [
      "Dados pessoais"
    ],
    "name": "Lei Geral de Proteção de Dados",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "itu",
    "group": "communications",
    "title": "ITU Radio Regulations",
    "edition": "2024",
    "subtitle": "Regras internacionais de espectro",
    "kind": "Regulamento internacional",
    "url": "https://www.itu.int/pub/R-REG-RR-2024",
    "scope": "Aplicação conforme serviço, região e coordenação pela administração competente. Não substitui a autorização brasileira.",
    "docs": [
      {
        "title": "Informações de publicação, coordenação ou notificação",
        "basis": "Determinar conforme o procedimento aplicável",
        "status": "confirm"
      }
    ],
    "extras": [
      "Mapa de interfaces de rádio",
      "Registro de premissas de coordenação"
    ],
    "note": "O regulamento integral não está incluído. Faixas específicas precisam ser verificadas na tabela e no plano nacional vigentes.",
    "tags": [
      "Frequências"
    ],
    "name": "ITU Radio Regulations",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ccsds",
    "group": "communications",
    "title": "CCSDS Blue Books",
    "edition": "Publicação selecionada por interface",
    "subtitle": "Protocolos e intercâmbio de dados",
    "kind": "Padrões técnicos",
    "url": "https://ccsds.org/publications/bluebooks/",
    "scope": "Escolher o Blue Book e a edição para cada interface. A família inteira não é automaticamente aplicável.",
    "docs": [],
    "extras": [
      "Especificação das interfaces de dados",
      "Matriz de compatibilidade de protocolos",
      "Registro de testes de interoperabilidade"
    ],
    "note": "Não há uma lista única de documentos obrigatórios para toda a coleção.",
    "tags": [
      "Telemetria",
      "Protocolos"
    ],
    "name": "CCSDS Blue Books",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ecss-com",
    "group": "communications",
    "title": "ECSS-E-ST-50C",
    "edition": "Rev. 2 · 2024",
    "subtitle": "Comunicações espaciais",
    "kind": "Norma técnica",
    "url": "https://ecss.nl/standards/active-standards/",
    "scope": "Quando a norma integra o contrato. A matriz de aplicabilidade do projeto define as entregas adotadas e os ajustes aceitos.",
    "docs": [
      {
        "title": "Documentação de comunicações",
        "basis": "Mapear na edição e no escopo adotados",
        "status": "confirm"
      }
    ],
    "extras": [
      "Matriz de interfaces de comunicação",
      "Registro de premissas do enlace"
    ],
    "note": "",
    "tags": [
      "Comunicações"
    ],
    "name": "ECSS-E-ST-50C",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "br-export",
    "group": "control",
    "title": "Lei 9.112",
    "edition": "1995 · texto consolidado",
    "subtitle": "Exportação de bens sensíveis",
    "kind": "Lei",
    "url": "https://www.planalto.gov.br/ccivil_03/leis/l9112.htm",
    "scope": "Para bens e serviços sujeitos ao controle brasileiro. A lista vigente, a classificação, o destino e o uso final precisam ser examinados.",
    "docs": [
      {
        "title": "Autorização prévia de exportação",
        "basis": "Art. 3 · quando o bem ou serviço está sujeito ao controle",
        "status": "required"
      },
      {
        "title": "Garantia de destino ou uso final",
        "basis": "Art. 3, § 1º · conforme exigência",
        "status": "required"
      },
      {
        "title": "Documentos adicionais da operação",
        "basis": "Art. 3, § 2º · quando solicitados",
        "status": "required"
      }
    ],
    "extras": [
      "Ficha de classificação do item",
      "Registro de decisões de acesso"
    ],
    "note": "O nome do projeto ou um único parâmetro técnico não resolve sua classificação.",
    "tags": [
      "MCTI",
      "CIBES"
    ],
    "name": "Lei 9.112",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "itar",
    "group": "control",
    "title": "ITAR",
    "edition": "22 CFR · subchapter M",
    "subtitle": "Artigos, serviços e dados de defesa",
    "kind": "Regulamento",
    "url": "https://www.ecfr.gov/current/title-22/chapter-I/subchapter-M/part-120/subpart-C/section-120.50",
    "scope": "Primeiro confirmar jurisdição, classificação e acesso a dados. Não é uma norma geral de projeto espacial.",
    "docs": [
      {
        "title": "Licença ou fundamento da autorização aplicável",
        "basis": "Conforme a operação e suas exceções",
        "status": "confirm"
      }
    ],
    "extras": [
      "Matriz de acesso a dados",
      "Registro de classificação e destino"
    ],
    "note": "O § 120.50 define exportação. Ele não determina, sozinho, se um arquivo ou acesso específico está proibido.",
    "tags": [
      "ITAR",
      "Acesso"
    ],
    "name": "ITAR",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "ear",
    "group": "control",
    "title": "EAR",
    "edition": "15 CFR · partes 730 a 774",
    "subtitle": "Exportação e reexportação",
    "kind": "Regulamento",
    "url": "https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-734",
    "scope": "Determinar jurisdição, classificação, usuário final, destino e uso final. A parte 734 trata do escopo.",
    "docs": [
      {
        "title": "Classificação e autorizações aplicáveis",
        "basis": "Definir de acordo com o item, destino e operação",
        "status": "confirm"
      }
    ],
    "extras": [
      "Ficha de classificação",
      "Mapa de compartilhamento entre equipes"
    ],
    "note": "Ter infraestrutura própria não elimina exigências de acesso ou transferência.",
    "tags": [
      "EAR",
      "Exportação"
    ],
    "name": "EAR",
    "referenceCheckedAt": "2026-10-12"
  },
  {
    "id": "mtcr",
    "group": "control",
    "title": "MTCR",
    "edition": "Diretrizes e anexo de controle",
    "subtitle": "Controle de transferência de tecnologia",
    "kind": "Regime de coordenação",
    "url": "https://www.mtcr.info/en/mtcr-guidelines",
    "scope": "Orienta controles de exportação implementados pelos países. Não é uma proibição geral de foguetes nem uma regra que transforma automaticamente um projeto em crime.",
    "docs": [],
    "extras": [
      "Ficha de enquadramento para análise especializada",
      "Registro de uso final e destino"
    ],
    "note": "A análise depende do item, das listas nacionais e da operação. Não há licença MTCR emitida pelo regime.",
    "tags": [
      "Uso final",
      "Tecnologia"
    ],
    "name": "MTCR",
    "referenceCheckedAt": "2026-10-12"
  }
];
