/** The fictitious missions shipped inside every demo sandbox.
 *
 * Four projects of one team, each with its design documents, the engineering
 * system derived from them and hypotheses already interpreted. Every property
 * cites an excerpt from a document, so the impact engine treats these models
 * exactly as it treats an extracted one. The hypotheses carry the structured
 * change a reviewer confirmed: Discovery evaluates them without an AI request,
 * and the architecture shows which subsystems each change reaches.
 *
 * Nothing here describes a real vehicle; names and figures are invented but
 * sized from typical COTS parts.
 */

function helpers(now) {
  const prop = (key, value, unit, ref, name = key.replaceAll("_", " ")) => ({ key, name, value, ...(unit ? { unit } : {}), source: "documented", evidenceRefs: [ref] });
  const entity = (id, name, kind, parentId, refs, properties = [], description = "") => ({ id, name, kind, ...(parentId ? { parentId } : {}), description, source: "documented", evidenceRefs: refs, confidence: 1, properties });
  const relation = (id, from, to, kind, refs, source = "documented") => ({ id, from, to, kind, label: kind.replaceAll("_", " "), source, evidenceRefs: refs, confidence: source === "inferred" ? 0.6 : 1 });
  const requirement = (id, title, statement, category, tags, relatedEntityIds, properties = []) => ({ id, title, statement, originalStatement: statement, category, subsystemTags: tags, reviewTags: [], status: "accepted", sourceRefs: ["requirements"], originalSourceRefs: ["requirements"], relatedEntityIds, relatedRelationIds: [], properties });
  const user = (key, value, unit, name = key.replaceAll("_", " ")) => ({ key, name, value, unit, source: "user", evidenceRefs: [] });
  const change = (id, targetEntityId, kind, description, newValues, replacementName) => ({ id, targetEntityId, kind, oldValues: [], newValues, description, createdAt: now, ...(replacementName ? { replacementName } : {}) });
  const card = (id, text, description, interpretedChange, maturity = "forming") => ({ id, text, description, pinned: true, maturity, createdAt: now, ...(interpretedChange ? { interpretedChange } : {}) });
  return { prop, entity, relation, requirement, user, change, card };
}

const CARD_SLOTS = [[140, 260], [140, 620], [620, 260], [620, 620]];

/** Turn a mission definition into stored documents, the engineering model and the idea board. */
export function buildMission(definition, artifactIdFor = (id) => id, now = new Date().toISOString()) {
  const h = helpers(now);
  const documents = definition.documents.map((document) => ({
    ...document,
    text: [`# ${document.label}`, "", document.preface, "", ...definition.facts.filter(([, artifact]) => artifact === document.id).flatMap(([, , excerpt, locator]) => [`## ${locator}`, "", excerpt, ""])].join("\n")
  }));
  const { entities, relations, requirements } = definition.system(h);
  const model = {
    schemaVersion: 1, id: `${definition.id}-design-system`, name: definition.name, generatedAt: now, generatedFromRevision: 1,
    entities, relations, requirements,
    evidence: definition.facts.map(([id, artifactId, excerpt, locator]) => ({ id, artifactId: artifactIdFor(artifactId), artifactLabel: definition.documents.find((document) => document.id === artifactId).label, excerpt, locator, kind: "fact" })),
    artifactSources: definition.documents.map((document) => ({ artifactId: artifactIdFor(document.id), artifactLabel: document.label, status: "parsed" }))
  };
  const { cards, links } = definition.hypotheses(h);
  const nodes = cards.map((card, index) => ({ ...card, x: CARD_SLOTS[index % CARD_SLOTS.length][0], y: CARD_SLOTS[index % CARD_SLOTS.length][1] }));
  return { documents, model, board: { nodes, links: links.map(([from, to]) => ({ id: `link-${from}-${to}`, from, to, createdAt: now })) } };
}

/* ────────────────────────────── Foguete Aurora ────────────────────────────── */

const AURORA = {
  id: "aurora", name: "Foguete Aurora", projectType: "competition",
  statement: "Foguete de sondagem para competição universitária, apogeu alvo de 3000 m, recuperação em dois estágios e telemetria em tempo real. Missão fictícia de demonstração.",
  sectors: ["Propulsão", "Estruturas", "Recuperação", "Aviônica", "Carga útil"],
  documents: [
    { id: "aurora-pdr", label: "Aurora — Revisão preliminar de projeto (PDR)", fileName: "aurora-pdr.md", sector: 1, description: "Missão, motor, estrutura, estabilidade, recuperação e requisitos.", preface: "Documento fictício de demonstração. Nenhum dado descreve um foguete real." },
    { id: "aurora-avionics", label: "Aurora — Aviônica e orçamento elétrico", fileName: "aurora-avionica.md", sector: 3, description: "Computador de voo, sensores, telemetria, bateria e regras de cálculo.", preface: "Documento fictício de demonstração. Valores típicos de componentes comerciais." }
  ],
  facts: [
    ["mission", "aurora-pdr", "Aurora é um foguete de sondagem de estágio único para competição universitária, com apogeu alvo de 3000 m e carga útil científica de 1 kg.", "PDR §1 Missão"],
    ["motor", "aurora-pdr", "Motor sólido comercial classe L: impulso total 4600 N·s, massa carregada 4,8 kg, tempo de queima 3,4 s.", "PDR §2 Propulsão"],
    ["airframe", "aurora-pdr", "Fuselagem em fibra de vidro com 127 mm de diâmetro e 2,4 m de comprimento; aletas trapezoidais em G10. Massa total da estrutura 4,2 kg.", "PDR §3 Estrutura"],
    ["stability", "aurora-pdr", "Margem de estabilidade estática de 2,1 calibres com o motor carregado; o centro de pressão fica a 1,62 m do nariz. A margem deve ser recalculada a cada mudança de massa.", "PDR §3.2 Estabilidade"],
    ["apogee", "aurora-pdr", "Apogeu simulado de 3080 m para a massa de decolagem de referência; cada 1 kg adicional reduz o apogeu em cerca de 260 m.", "PDR §4 Trajetória"],
    ["recovery", "aurora-pdr", "Recuperação em dois estágios: drogue no apogeu e paraquedas principal a 450 m. Velocidade de descida sob o principal de 5,5 m/s para a massa de referência. Massa do sistema 0,9 kg.", "PDR §5 Recuperação"],
    ["payload", "aurora-pdr", "Carga útil científica em formato CanSat de 1,0 kg, alojada acima da baia de aviônica.", "PDR §6 Carga útil"],
    ["flight-computer", "aurora-avionics", "Computador de voo com IMU e barômetro: consumo 0,6 W; massa 80 g.", "Aviônica §1"],
    ["altimeter", "aurora-avionics", "Altímetro redundante para acionamento da recuperação: 0,2 W; massa 40 g.", "Aviônica §2"],
    ["gps", "aurora-avionics", "Rastreador GPS: 0,35 W; massa 60 g.", "Aviônica §3"],
    ["telemetry", "aurora-avionics", "Rádio de telemetria de 900 MHz, transmissão contínua a 1,2 W; massa 70 g.", "Aviônica §4"],
    ["battery", "aurora-avionics", "Bateria LiPo 2S de 1500 mAh (11,1 Wh); massa 90 g. Alimenta toda a baia por um barramento de 7,4 V.", "Aviônica §5 Energia"],
    ["bay", "aurora-avionics", "Baia de aviônica com anteparos e trilhos: 350 g.", "Aviônica §6"],
    ["budget-rule", "aurora-avionics", "Consumo da baia = soma do consumo contínuo de cada equipamento.", "Aviônica §7.1 Regra"],
    ["autonomy-rule", "aurora-avionics", "Autonomia = energia disponível na bateria ÷ consumo da baia.", "Aviônica §7.2 Regra"],
    ["mass-rule", "aurora-pdr", "Massa de decolagem = soma das massas de motor, estrutura, recuperação, aviônica e carga útil.", "PDR §7 Regra de massa"],
    ["requirements", "aurora-pdr", "Requisitos: MI-001 massa de decolagem ≤ 12 kg (limite do trilho de lançamento); MI-002 autonomia da aviônica ≥ 180 min (espera na rampa + voo); MI-003 apogeu entre 2700 e 3300 m; MI-004 margem de estabilidade entre 1,5 e 3 calibres; MI-005 descida sob o principal ≤ 6 m/s.", "PDR §8 Requisitos"]
  ],
  system: ({ prop, entity, relation, requirement }) => ({
    entities: [
      entity("system", "Foguete Aurora", "system", undefined, ["mission"], [], "Foguete de sondagem de estágio único."),
      entity("propulsion", "Propulsão", "subsystem", "system", ["motor"]),
      entity("motor", "Motor classe L", "component", "propulsion", ["motor"], [prop("total_impulse", 4600, "N·s", "motor", "impulso total"), prop("mass", 4.8, "kg", "motor"), prop("burn_time", 3.4, "s", "motor", "tempo de queima")]),
      entity("structure", "Estrutura", "subsystem", "system", ["airframe"]),
      entity("airframe", "Fuselagem e aletas", "component", "structure", ["airframe"], [prop("mass", 4.2, "kg", "airframe"), prop("diameter", 127, "mm", "airframe", "diâmetro"), prop("length", 2.4, "m", "airframe", "comprimento")]),
      entity("mass-budget", "Massa de decolagem", "calculation", "structure", ["mass-rule"], [prop("formula", "sum_mass", undefined, "mass-rule")]),
      entity("stability", "Margem de estabilidade", "performance", "structure", ["stability"], [prop("stability_margin", 2.1, "cal", "stability", "margem de estabilidade")], "Distância entre centro de pressão e centro de massa."),
      entity("apogee", "Apogeu", "performance", "system", ["apogee"], [prop("apogee", 3080, "m", "apogee")], "Depende da massa de decolagem e do impulso do motor."),
      entity("recovery", "Recuperação", "subsystem", "system", ["recovery"]),
      entity("parachutes", "Drogue e paraquedas principal", "component", "recovery", ["recovery"], [prop("mass", 0.9, "kg", "recovery")]),
      entity("descent", "Velocidade de descida", "performance", "recovery", ["recovery"], [prop("descent_rate", 5.5, "m/s", "recovery", "velocidade de descida")], "Sob o paraquedas principal; cresce com a massa."),
      entity("avionics", "Aviônica", "subsystem", "system", ["flight-computer"]),
      entity("flight-computer", "Computador de voo", "component", "avionics", ["flight-computer"], [prop("operating_power", 0.6, "W", "flight-computer"), prop("mass", 80, "g", "flight-computer")]),
      entity("altimeter", "Altímetro redundante", "component", "avionics", ["altimeter"], [prop("operating_power", 0.2, "W", "altimeter"), prop("mass", 40, "g", "altimeter")]),
      entity("gps", "Rastreador GPS", "component", "avionics", ["gps"], [prop("operating_power", 0.35, "W", "gps"), prop("mass", 60, "g", "gps")]),
      entity("telemetry", "Rádio de telemetria", "component", "avionics", ["telemetry"], [prop("operating_power", 1.2, "W", "telemetry"), prop("mass", 70, "g", "telemetry")]),
      entity("battery", "Bateria LiPo 2S", "component", "avionics", ["battery"], [prop("available_energy", 11.1, "Wh", "battery", "energia disponível"), prop("output_voltage", 7.4, "V", "battery"), prop("mass", 90, "g", "battery")]),
      entity("bay", "Baia de aviônica", "component", "avionics", ["bay"], [prop("mass", 350, "g", "bay")]),
      entity("power-budget", "Consumo da baia", "calculation", "avionics", ["budget-rule"], [prop("formula", "sum_power", undefined, "budget-rule")]),
      entity("autonomy", "Autonomia da aviônica", "performance", "avionics", ["autonomy-rule"], [prop("formula", "energy_over_power", undefined, "autonomy-rule")]),
      entity("payload", "Carga útil", "subsystem", "system", ["payload"]),
      entity("cansat", "CanSat científico", "component", "payload", ["payload"], [prop("mass", 1, "kg", "payload")])
    ],
    relations: [
      ...["flight-computer", "altimeter", "gps", "telemetry"].map((id) => relation(`battery-${id}`, "battery", id, "powers", ["battery"])),
      ...["flight-computer", "altimeter", "gps", "telemetry"].map((id) => relation(`${id}-budget`, id, "power-budget", "contributes_to", ["budget-rule"])),
      relation("autonomy-energy", "autonomy", "battery", "derived_from", ["autonomy-rule"]),
      relation("autonomy-demand", "autonomy", "power-budget", "derived_from", ["autonomy-rule"]),
      ...["motor", "airframe", "parachutes", "flight-computer", "altimeter", "gps", "telemetry", "battery", "bay", "cansat"].map((id) => relation(`${id}-mass`, id, "mass-budget", "contributes_to", ["mass-rule"])),
      relation("apogee-mass", "apogee", "mass-budget", "derived_from", ["apogee"]),
      relation("apogee-motor", "apogee", "motor", "derived_from", ["apogee"]),
      relation("stability-mass", "stability", "mass-budget", "derived_from", ["stability"]),
      relation("stability-airframe", "stability", "airframe", "derived_from", ["stability"]),
      relation("descent-mass", "descent", "mass-budget", "derived_from", ["recovery"]),
      relation("descent-parachutes", "descent", "parachutes", "derived_from", ["recovery"]),
      relation("altimeter-recovery", "parachutes", "altimeter", "depends_on", ["altimeter"]),
      relation("cansat-bay", "cansat", "bay", "mounted_on", ["payload"])
    ],
    requirements: [
      requirement("MI-001", "Massa de decolagem", "A massa de decolagem não deve exceder 12 kg, limite do trilho de lançamento.", "Lançamento", ["Estruturas"], ["mass-budget"], [prop("maximum_mass", 12, "kg", "requirements")]),
      requirement("MI-002", "Autonomia da aviônica", "A aviônica deve operar por pelo menos 180 min entre a montagem na rampa e a recuperação.", "Aviônica", ["Aviônica"], ["autonomy"], [prop("minimum_autonomy", 180, "min", "requirements")]),
      requirement("MI-003", "Apogeu", "O apogeu deve ficar entre 2700 e 3300 m.", "Missão", ["Propulsão"], ["apogee"], [prop("minimum_apogee", 2700, "m", "requirements"), prop("maximum_apogee", 3300, "m", "requirements")]),
      requirement("MI-004", "Estabilidade", "A margem de estabilidade estática deve ficar entre 1,5 e 3 calibres.", "Segurança", ["Estruturas"], ["stability"], [prop("minimum_stability_margin", 1.5, "cal", "requirements")]),
      requirement("MI-005", "Descida segura", "A velocidade de descida sob o paraquedas principal deve ser ≤ 6 m/s.", "Segurança", ["Recuperação"], ["descent"], [prop("maximum_descent_rate", 6, "m/s", "requirements")])
    ]
  }),
  hypotheses: ({ user, change, card }) => ({
    cards: [
      card("idea-motor", "Trocar o motor por um classe M para ganhar apogeu", "Substituir o motor classe L por um classe M de 7,5 kg carregado e 8000 N·s de impulso total.",
        change("change-motor", "motor", "replace_component", "Motor classe M no lugar do classe L: 7,5 kg carregado, 8000 N·s, queima de 4,1 s.", [user("total_impulse", 8000, "N·s", "impulso total"), user("mass", 7.5, "kg"), user("burn_time", 4.1, "s", "tempo de queima")], "Motor classe M")),
      card("idea-camera", "Computador de voo com câmera de bordo", "Substituir o computador de voo por um módulo com câmera HD gravando durante todo o voo: 3,1 W e 200 g.",
        change("change-camera", "flight-computer", "replace_component", "Computador de voo com câmera HD: 3,1 W contínuos e 200 g.", [user("operating_power", 3.1, "W"), user("mass", 200, "g")], "Computador de voo com câmera")),
      card("idea-battery", "Bateria 2S de 3000 mAh para folga na rampa", "Trocar a bateria por uma LiPo 2S de 3000 mAh (22,2 Wh) com 180 g.",
        change("change-battery", "battery", "parameter", "Bateria LiPo 2S de 3000 mAh: 22,2 Wh e 180 g.", [user("available_energy", 22.2, "Wh", "energia disponível"), user("mass", 180, "g")]), "draft"),
      card("idea-fins", "E se as aletas fossem em fibra de carbono?", undefined, undefined, "draft")
    ],
    links: [["idea-motor", "idea-camera"], ["idea-camera", "idea-battery"], ["idea-motor", "idea-fins"]]
  })
};

/* ───────────────────────────── Pesquisa Atmosfera ───────────────────────────── */

const ATMOSFERA = {
  id: "atmosfera", name: "Pesquisa Atmosfera", projectType: "research",
  statement: "Sonda de balão estratosférico com sensores de baixo custo para perfis de temperatura, umidade, pressão e material particulado até 30 km. Missão fictícia de demonstração.",
  sectors: ["Pesquisa", "Instrumentação", "Análise de dados"],
  documents: [
    { id: "atm-plan", label: "Atmosfera — Plano de voo e requisitos", fileName: "atmosfera-plano-de-voo.md", sector: 0, description: "Objetivo científico, trem de voo, ascensão, enlace e requisitos.", preface: "Documento fictício de demonstração. Nenhum dado descreve um voo real." },
    { id: "atm-payload", label: "Atmosfera — Carga útil e orçamento elétrico", fileName: "atmosfera-carga-util.md", sector: 1, description: "Sensores, registrador, rádio, bateria, aquecimento e regras de cálculo.", preface: "Documento fictício de demonstração. Valores típicos de sensores comerciais." }
  ],
  facts: [
    ["mission", "atm-plan", "Voo de balão estratosférico até 30 km para medir perfis verticais de temperatura, umidade, pressão e material particulado sobre o Cerrado.", "Plano §1 Objetivo"],
    ["balloon", "atm-plan", "Balão de látex de 1200 g inflado com hélio para 1,4 kg de sustentação livre; taxa de ascensão de 5 m/s para a massa de referência da carga útil.", "Plano §2 Trem de voo"],
    ["ascent", "atm-plan", "Cada 100 g adicionais na carga útil reduzem a ascensão em cerca de 0,3 m/s e prolongam o voo; a sustentação deve ser recalculada.", "Plano §2.1 Ascensão"],
    ["link", "atm-plan", "Enlace LoRa de 915 MHz com alcance de 60 km em linha de visada; pacotes a cada 15 s.", "Plano §3 Enlace"],
    ["enclosure", "atm-payload", "Caixa isolada em EPS com 180 g; mantém a bateria acima de −10 °C junto com o aquecedor.", "Carga útil §1 Caixa"],
    ["probe", "atm-payload", "Sonda de temperatura e umidade: 0,05 W; 15 g.", "Carga útil §2"],
    ["pressure", "atm-payload", "Sensor barométrico: 0,02 W; 5 g.", "Carga útil §3"],
    ["particulate", "atm-payload", "Sensor óptico de material particulado com ventoinha: 0,4 W; 60 g.", "Carga útil §4"],
    ["logger", "atm-payload", "Registrador com microcontrolador e cartão SD: 0,25 W; 30 g.", "Carga útil §5"],
    ["gps", "atm-payload", "Receptor GPS para alta altitude: 0,15 W; 20 g.", "Carga útil §6"],
    ["radio", "atm-payload", "Rádio LoRa: 0,5 W ao transmitir, ativo 30 % do tempo; 40 g.", "Carga útil §7"],
    ["battery", "atm-payload", "Bateria Li-ion de 3000 mAh (11,1 Wh) selecionada para frio; 95 g.", "Carga útil §8 Energia"],
    ["heater", "atm-payload", "Aquecedor resistivo da bateria: 0,8 W ativo 25 % do tempo; 20 g.", "Carga útil §9"],
    ["active-load-rule", "atm-payload", "Cargas intermitentes entram no orçamento pela potência média = potência ativa × fração ativa.", "Carga útil §10.1 Regra"],
    ["budget-rule", "atm-payload", "Consumo da carga útil = soma das potências médias.", "Carga útil §10.2 Regra"],
    ["autonomy-rule", "atm-payload", "Autonomia = energia da bateria ÷ consumo da carga útil.", "Carga útil §10.3 Regra"],
    ["mass-rule", "atm-payload", "Massa da carga útil = soma das massas dentro da caixa.", "Carga útil §11 Regra"],
    ["thermal", "atm-payload", "Sensores com dissipação acima de 1 W dentro da caixa exigem nova análise térmica do isolamento.", "Carga útil §12 Térmico"],
    ["requirements", "atm-plan", "Requisitos: MI-001 massa da carga útil ≤ 600 g (regra de balão livre leve); MI-002 autonomia ≥ 300 min (voo de 3 h e recuperação); MI-003 ascensão entre 4 e 6 m/s; MI-004 alcance do enlace ≥ 50 km; MI-005 amostra completa a cada 15 s.", "Plano §4 Requisitos"]
  ],
  system: ({ prop, entity, relation, requirement }) => ({
    entities: [
      entity("system", "Sonda Atmosfera", "system", undefined, ["mission"], [], "Carga útil de balão estratosférico."),
      entity("flight-train", "Trem de voo", "subsystem", "system", ["balloon"]),
      entity("balloon", "Balão de látex", "component", "flight-train", ["balloon"], [prop("free_lift", 1.4, "kg", "balloon", "sustentação livre"), prop("mass", 1200, "g", "balloon")]),
      entity("ascent", "Taxa de ascensão", "performance", "flight-train", ["ascent"], [prop("ascent_rate", 5, "m/s", "balloon", "taxa de ascensão")], "Depende da sustentação e da massa da carga útil."),
      entity("payload", "Carga útil", "subsystem", "system", ["enclosure"]),
      entity("enclosure", "Caixa isolada", "component", "payload", ["enclosure"], [prop("mass", 180, "g", "enclosure")]),
      entity("probe", "Sonda de temperatura e umidade", "component", "payload", ["probe"], [prop("operating_power", 0.05, "W", "probe"), prop("mass", 15, "g", "probe")]),
      entity("pressure", "Sensor barométrico", "component", "payload", ["pressure"], [prop("operating_power", 0.02, "W", "pressure"), prop("mass", 5, "g", "pressure")]),
      entity("particulate", "Sensor de material particulado", "component", "payload", ["particulate"], [prop("operating_power", 0.4, "W", "particulate"), prop("mass", 60, "g", "particulate")]),
      entity("logger", "Registrador de dados", "component", "payload", ["logger"], [prop("operating_power", 0.25, "W", "logger"), prop("mass", 30, "g", "logger")]),
      entity("gps", "Receptor GPS", "component", "payload", ["gps"], [prop("operating_power", 0.15, "W", "gps"), prop("mass", 20, "g", "gps")]),
      entity("comms", "Enlace", "subsystem", "system", ["link"]),
      entity("radio", "Rádio LoRa", "component", "comms", ["radio"], [prop("operating_power", 0.5, "W", "radio"), prop("duty_cycle", 30, "%", "radio"), prop("mass", 40, "g", "radio")]),
      entity("radio-average", "Potência média do rádio", "calculation", "comms", ["active-load-rule"], [prop("formula", "duty_cycle_load", undefined, "active-load-rule")]),
      entity("range", "Alcance do enlace", "performance", "comms", ["link"], [prop("link_range", 60, "km", "link", "alcance")], "Linha de visada com a estação de recepção."),
      entity("power", "Energia", "subsystem", "system", ["battery"]),
      entity("battery", "Bateria Li-ion", "component", "power", ["battery"], [prop("available_energy", 11.1, "Wh", "battery", "energia disponível"), prop("mass", 95, "g", "battery")]),
      entity("heater", "Aquecedor da bateria", "component", "power", ["heater"], [prop("operating_power", 0.8, "W", "heater"), prop("duty_cycle", 25, "%", "heater"), prop("mass", 20, "g", "heater")]),
      entity("heater-average", "Potência média do aquecedor", "calculation", "power", ["active-load-rule"], [prop("formula", "duty_cycle_load", undefined, "active-load-rule")]),
      entity("power-budget", "Consumo da carga útil", "calculation", "power", ["budget-rule"], [prop("formula", "sum_power", undefined, "budget-rule")]),
      entity("autonomy", "Autonomia", "performance", "power", ["autonomy-rule"], [prop("formula", "energy_over_power", undefined, "autonomy-rule")]),
      entity("mass-budget", "Massa da carga útil", "calculation", "payload", ["mass-rule"], [prop("formula", "sum_mass", undefined, "mass-rule")])
    ],
    relations: [
      ...["probe", "pressure", "particulate", "logger", "gps", "radio", "heater"].map((id) => relation(`battery-${id}`, "battery", id, "powers", ["battery"])),
      relation("radio-average-input", "radio-average", "radio", "derived_from", ["active-load-rule"]),
      relation("heater-average-input", "heater-average", "heater", "derived_from", ["active-load-rule"]),
      ...["probe", "pressure", "particulate", "logger", "gps", "radio-average", "heater-average"].map((id) => relation(`${id}-budget`, id, "power-budget", "contributes_to", ["budget-rule"])),
      relation("autonomy-energy", "autonomy", "battery", "derived_from", ["autonomy-rule"]),
      relation("autonomy-demand", "autonomy", "power-budget", "derived_from", ["autonomy-rule"]),
      ...["enclosure", "probe", "pressure", "particulate", "logger", "gps", "radio", "battery", "heater"].map((id) => relation(`${id}-mass`, id, "mass-budget", "contributes_to", ["mass-rule"])),
      relation("ascent-mass", "ascent", "mass-budget", "derived_from", ["ascent"]),
      relation("ascent-balloon", "ascent", "balloon", "derived_from", ["balloon"]),
      relation("range-radio", "range", "radio", "derived_from", ["link"]),
      relation("particulate-thermal", "particulate", "enclosure", "thermal_coupling", ["thermal"]),
      relation("enclosure-battery", "enclosure", "battery", "affects", ["enclosure"]),
      relation("logger-sensors", "logger", "probe", "measured_by", ["logger"], "inferred")
    ],
    requirements: [
      requirement("MI-001", "Massa da carga útil", "A carga útil não deve exceder 600 g para permanecer na categoria de balão livre leve.", "Regulatório", ["Instrumentação"], ["mass-budget"], [prop("maximum_mass", 600, "g", "requirements")]),
      requirement("MI-002", "Autonomia", "A carga útil deve operar por pelo menos 300 min: voo de 3 h mais a recuperação.", "Missão", ["Instrumentação"], ["autonomy"], [prop("minimum_autonomy", 300, "min", "requirements")]),
      requirement("MI-003", "Ascensão", "A taxa de ascensão deve ficar entre 4 e 6 m/s.", "Missão", ["Pesquisa"], ["ascent"], [prop("minimum_ascent_rate", 4, "m/s", "requirements"), prop("maximum_ascent_rate", 6, "m/s", "requirements")]),
      requirement("MI-004", "Alcance do enlace", "O enlace deve manter ≥ 50 km de alcance em linha de visada.", "Missão", ["Instrumentação"], ["range"], [prop("minimum_link_range", 50, "km", "requirements")]),
      requirement("MI-005", "Amostragem", "Uma amostra completa de todos os sensores deve ser registrada a cada 15 s.", "Ciência", ["Análise de dados"], ["logger"])
    ]
  }),
  hypotheses: ({ user, change, card }) => ({
    cards: [
      card("idea-ozone", "Sensor combinado de particulado e ozônio", "Substituir o sensor de material particulado por um módulo combinado de particulado e ozônio com célula aquecida: 2,4 W e 210 g.",
        change("change-ozone", "particulate", "replace_component", "Módulo combinado de particulado e ozônio: 2,4 W contínuos e 210 g.", [user("operating_power", 2.4, "W"), user("mass", 210, "g")], "Sensor de particulado e ozônio")),
      card("idea-small-battery", "Bateria menor para ganhar massa", "Trocar a bateria por uma de 1500 mAh (5,55 Wh) com 50 g.",
        change("change-small-battery", "battery", "parameter", "Bateria de 1500 mAh: 5,55 Wh e 50 g.", [user("available_energy", 5.55, "Wh", "energia disponível"), user("mass", 50, "g")])),
      card("idea-double-battery", "Duas baterias em paralelo", "Dobrar a energia disponível com duas células em paralelo: 22,2 Wh e 190 g.",
        change("change-double-battery", "battery", "parameter", "Duas células em paralelo: 22,2 Wh e 190 g.", [user("available_energy", 22.2, "Wh", "energia disponível"), user("mass", 190, "g")]), "draft"),
      card("idea-cutdown", "Vale adicionar um mecanismo de corte para encurtar o voo?", undefined, undefined, "draft")
    ],
    links: [["idea-ozone", "idea-double-battery"], ["idea-ozone", "idea-small-battery"], ["idea-double-battery", "idea-cutdown"]]
  })
};

/* ─────────────────────────────── Estação Solo ─────────────────────────────── */

const ESTACAO = {
  id: "estacao", name: "Estação Solo", projectType: "product",
  statement: "Estação de solo portátil em UHF para receber telemetria e comandar cargas úteis em campo, operada por uma pessoa e alimentada por bateria. Missão fictícia de demonstração.",
  sectors: ["Software", "Eletrônica", "Validação"],
  documents: [
    { id: "gs-spec", label: "Estação Solo — Especificação do produto", fileName: "estacao-solo-especificacao.md", sector: 2, description: "Caso de uso, antena, rastreamento, enlace e requisitos.", preface: "Documento fictício de demonstração. Nenhum dado descreve um produto real." },
    { id: "gs-electrical", label: "Estação Solo — Orçamento elétrico e massa", fileName: "estacao-solo-orcamento.md", sector: 1, description: "Consumo de cada módulo, bateria, massa e regras de cálculo.", preface: "Documento fictício de demonstração. Valores típicos de equipamentos comerciais." }
  ],
  facts: [
    ["mission", "gs-spec", "Estação de solo portátil em UHF para telemetria e comando de CubeSats e sondas, montada em campo por uma pessoa em menos de 20 min.", "Especificação §1 Caso de uso"],
    ["antenna", "gs-spec", "Antena Yagi cruzada de 435 MHz com ganho de 12 dBi; 2,4 kg com o mastro curto.", "Especificação §2 Antena"],
    ["rotator", "gs-spec", "Rotor de azimute e elevação com precisão de 1°: motores consomem 24 W em movimento, ativos 20 % de uma passagem; 3,1 kg.", "Especificação §3 Rastreamento"],
    ["tracking", "gs-spec", "A precisão de rastreamento depende do rotor e da massa da antena; antenas acima de 3 kg exigem nova validação do rotor.", "Especificação §3.1"],
    ["link", "gs-spec", "Margem de enlace de 6 dB no downlink com o LNA e a antena de referência.", "Especificação §4 Enlace"],
    ["lna", "gs-electrical", "Amplificador de baixo ruído na antena: 0,3 W; 60 g.", "Orçamento §1 LNA"],
    ["sdr", "gs-electrical", "Receptor SDR: 2,5 W; 150 g.", "Orçamento §2 SDR"],
    ["transceiver", "gs-electrical", "Transceptor de uplink: 12 W ao transmitir, 1 W em recepção, transmitindo 10 % da passagem; 400 g.", "Orçamento §3 Transceptor"],
    ["computer", "gs-electrical", "Computador de placa única com software de rastreamento e decodificação: 5 W; 120 g.", "Orçamento §4 Computador"],
    ["router", "gs-electrical", "Roteador 4G para envio dos dados: 3 W; 90 g.", "Orçamento §5 Rede"],
    ["battery", "gs-electrical", "Bateria LiFePO4 de 12 V e 20 Ah (256 Wh); 2,6 kg. Alimenta todos os módulos por um barramento de 12 V com 60 W disponíveis.", "Orçamento §6 Energia"],
    ["case", "gs-electrical", "Maleta, cabos e tripé: 2,0 kg.", "Orçamento §7 Transporte"],
    ["radio-average-rule", "gs-electrical", "Potência média do transceptor = P_tx × fração de transmissão + P_rx × (1 − fração).", "Orçamento §8.1 Regra"],
    ["active-load-rule", "gs-electrical", "O rotor entra no orçamento pela potência média = potência em movimento × fração ativa.", "Orçamento §8.2 Regra"],
    ["budget-rule", "gs-electrical", "Consumo total = soma das potências médias dos módulos.", "Orçamento §8.3 Regra"],
    ["autonomy-rule", "gs-electrical", "Autonomia = energia da bateria ÷ consumo total.", "Orçamento §8.4 Regra"],
    ["mass-rule", "gs-electrical", "Massa transportada = soma das massas de todos os módulos.", "Orçamento §9 Regra"],
    ["requirements", "gs-spec", "Requisitos: PR-001 massa transportada ≤ 12 kg (uma pessoa); PR-002 autonomia ≥ 480 min (dia de campo); PR-003 margem de enlace ≥ 3 dB; PR-004 precisão de rastreamento ≤ 2°; PR-005 montagem em ≤ 20 min.", "Especificação §5 Requisitos"]
  ],
  system: ({ prop, entity, relation, requirement }) => ({
    entities: [
      entity("system", "Estação Solo", "system", undefined, ["mission"], [], "Estação de solo portátil em UHF."),
      entity("rf", "Cadeia de RF", "subsystem", "system", ["antenna"]),
      entity("antenna", "Antena Yagi cruzada", "component", "rf", ["antenna"], [prop("gain", 12, "dBi", "antenna", "ganho"), prop("mass", 2.4, "kg", "antenna")]),
      entity("lna", "Amplificador de baixo ruído", "component", "rf", ["lna"], [prop("operating_power", 0.3, "W", "lna"), prop("mass", 60, "g", "lna")]),
      entity("sdr", "Receptor SDR", "component", "rf", ["sdr"], [prop("operating_power", 2.5, "W", "sdr"), prop("mass", 150, "g", "sdr")]),
      entity("transceiver", "Transceptor de uplink", "component", "rf", ["transceiver"], [prop("tx_power", 12, "W", "transceiver"), prop("rx_power", 1, "W", "transceiver"), prop("tx_duty_cycle", 10, "%", "transceiver"), prop("mass", 400, "g", "transceiver")]),
      entity("transceiver-average", "Potência média do transceptor", "calculation", "rf", ["radio-average-rule"], [prop("formula", "duty_cycle_power", undefined, "radio-average-rule")]),
      entity("link-margin", "Margem de enlace", "performance", "rf", ["link"], [prop("link_margin", 6, "dB", "link", "margem de enlace")], "Downlink com a antena e o LNA de referência."),
      entity("tracking", "Rastreamento", "subsystem", "system", ["rotator"]),
      entity("rotator", "Rotor de azimute e elevação", "component", "tracking", ["rotator"], [prop("operating_power", 24, "W", "rotator"), prop("duty_cycle", 20, "%", "rotator"), prop("mass", 3.1, "kg", "rotator")]),
      entity("rotator-average", "Potência média do rotor", "calculation", "tracking", ["active-load-rule"], [prop("formula", "duty_cycle_load", undefined, "active-load-rule")]),
      entity("tracking-accuracy", "Precisão de rastreamento", "performance", "tracking", ["tracking"], [prop("tracking_accuracy", 1, "°", "rotator", "precisão")], "Depende do rotor e da massa da antena."),
      entity("computing", "Computação e rede", "subsystem", "system", ["computer"]),
      entity("computer", "Computador de placa única", "component", "computing", ["computer"], [prop("operating_power", 5, "W", "computer"), prop("mass", 120, "g", "computer")]),
      entity("router", "Roteador 4G", "component", "computing", ["router"], [prop("operating_power", 3, "W", "router"), prop("mass", 90, "g", "router")]),
      entity("power", "Energia", "subsystem", "system", ["battery"]),
      entity("battery", "Bateria LiFePO4", "component", "power", ["battery"], [prop("available_energy", 256, "Wh", "battery", "energia disponível"), prop("mass", 2.6, "kg", "battery")]),
      entity("bus-12v", "Barramento 12 V", "interface", "power", ["battery"], [prop("output_voltage", 12, "V", "battery"), prop("available_power", 60, "W", "battery")]),
      entity("power-budget", "Consumo total", "calculation", "power", ["budget-rule"], [prop("formula", "sum_power", undefined, "budget-rule")]),
      entity("autonomy", "Autonomia", "performance", "power", ["autonomy-rule"], [prop("formula", "energy_over_power", undefined, "autonomy-rule")]),
      entity("transport", "Transporte", "subsystem", "system", ["case"]),
      entity("case", "Maleta, cabos e tripé", "component", "transport", ["case"], [prop("mass", 2, "kg", "case")]),
      entity("mass-budget", "Massa transportada", "calculation", "transport", ["mass-rule"], [prop("formula", "sum_mass", undefined, "mass-rule")])
    ],
    relations: [
      relation("battery-bus", "battery", "bus-12v", "powers", ["battery"]),
      ...["lna", "sdr", "transceiver", "rotator", "computer", "router"].map((id) => relation(`bus-${id}`, "bus-12v", id, "powers", ["battery"])),
      relation("transceiver-average-input", "transceiver-average", "transceiver", "derived_from", ["radio-average-rule"]),
      relation("rotator-average-input", "rotator-average", "rotator", "derived_from", ["active-load-rule"]),
      ...["lna", "sdr", "transceiver-average", "rotator-average", "computer", "router"].map((id) => relation(`${id}-budget`, id, "power-budget", "contributes_to", ["budget-rule"])),
      relation("autonomy-energy", "autonomy", "battery", "derived_from", ["autonomy-rule"]),
      relation("autonomy-demand", "autonomy", "power-budget", "derived_from", ["autonomy-rule"]),
      ...["antenna", "lna", "sdr", "transceiver", "rotator", "computer", "router", "battery", "case"].map((id) => relation(`${id}-mass`, id, "mass-budget", "contributes_to", ["mass-rule"])),
      relation("link-antenna", "link-margin", "antenna", "derived_from", ["link"]),
      relation("link-lna", "link-margin", "lna", "derived_from", ["link"]),
      relation("link-transceiver", "link-margin", "transceiver", "derived_from", ["link"]),
      relation("tracking-rotator", "tracking-accuracy", "rotator", "derived_from", ["tracking"]),
      relation("tracking-antenna", "tracking-accuracy", "antenna", "derived_from", ["tracking"]),
      relation("antenna-rotator", "antenna", "rotator", "mounted_on", ["tracking"]),
      relation("computer-rotator", "rotator", "computer", "depends_on", ["computer"]),
      relation("sdr-computer", "sdr", "computer", "connects_to", ["computer"])
    ],
    requirements: [
      requirement("PR-001", "Massa transportada", "A estação completa deve pesar ≤ 12 kg para ser transportada por uma pessoa.", "Produto", ["Validação"], ["mass-budget"], [prop("maximum_mass", 12, "kg", "requirements")]),
      requirement("PR-002", "Autonomia", "A estação deve operar por ≥ 480 min com a bateria, um dia de campo.", "Produto", ["Eletrônica"], ["autonomy"], [prop("minimum_autonomy", 480, "min", "requirements")]),
      requirement("PR-003", "Margem de enlace", "O downlink deve manter margem ≥ 3 dB.", "Desempenho", ["Eletrônica"], ["link-margin"], [prop("minimum_link_margin", 3, "dB", "requirements")]),
      requirement("PR-004", "Rastreamento", "A precisão de rastreamento deve ser ≤ 2°.", "Desempenho", ["Software"], ["tracking-accuracy"], [prop("maximum_tracking_error", 2, "°", "requirements")]),
      requirement("PR-005", "Montagem", "A estação deve ser montada em campo em ≤ 20 min.", "Produto", ["Validação"], ["case"])
    ]
  }),
  hypotheses: ({ user, change, card }) => ({
    cards: [
      card("idea-minipc", "Trocar o computador por um mini-PC x86", "Substituir o computador de placa única por um mini-PC x86 para decodificar mais modos ao mesmo tempo: 28 W e 900 g.",
        change("change-minipc", "computer", "replace_component", "Mini-PC x86 no lugar do computador de placa única: 28 W e 900 g.", [user("operating_power", 28, "W"), user("mass", 900, "g")], "Mini-PC x86")),
      card("idea-amplifier", "Amplificador de 50 W no uplink", "Substituir o transceptor por um conjunto com amplificador de 50 W para comandar satélites em passagens baixas: 1,6 kg.",
        change("change-amplifier", "transceiver", "replace_component", "Transceptor com amplificador de 50 W: 50 W ao transmitir, 1 W em recepção, 10 % da passagem, 1,6 kg.", [user("tx_power", 50, "W"), user("rx_power", 1, "W"), user("tx_duty_cycle", 10, "%"), user("mass", 1.6, "kg")], "Transceptor com amplificador")),
      card("idea-antenna", "Yagi dupla de 15 dBi", "Trocar a antena por uma Yagi dupla de 15 dBi com 4,8 kg para ganhar margem de enlace.",
        change("change-antenna", "antenna", "parameter", "Yagi dupla de 15 dBi com 4,8 kg.", [user("gain", 15, "dBi", "ganho"), user("mass", 4.8, "kg")]), "draft"),
      card("idea-solar", "Painel solar dobrável para dias longos?", undefined, undefined, "draft")
    ],
    links: [["idea-minipc", "idea-amplifier"], ["idea-amplifier", "idea-antenna"], ["idea-minipc", "idea-solar"]]
  })
};

/* ────────────────────────────────── Horizonte-1 ────────────────────────────────── */

const HORIZONTE = {
  id: "horizonte", name: "Horizonte-1 · CubeSat 2U", projectType: "research",
  statement: "CubeSat 2U de observação da Terra para monitoramento agrícola do Cerrado. Missão fictícia de demonstração: os documentos, o sistema e as hipóteses são exemplos.",
  sectors: ["EPS", "COMMS", "ADCS", "Estrutura e térmico", "Carga útil"],
  documents: [
    { id: "horizonte1-pdr", label: "Horizonte-1 — Revisão preliminar de projeto (PDR)", fileName: "horizonte1-pdr.md", sector: 3, description: "Missão, órbita, arquitetura, ADCS, balanceamento, térmico, dados e requisitos.", preface: "Documento fictício de demonstração. Nenhum dado descreve um satélite real." },
    { id: "horizonte1-budgets", label: "Horizonte-1 — Orçamentos de massa e potência", fileName: "horizonte1-orcamentos.md", sector: 0, description: "Geração, armazenamento, distribuição, consumo de cada equipamento e regras de cálculo.", preface: "Documento fictício de demonstração. Valores típicos de componentes comerciais para CubeSat 2U." }
  ],
  facts: [
    ["mission", "horizonte1-pdr", "Horizonte-1 é um CubeSat 2U de observação da Terra para monitoramento agrícola do Cerrado, em órbita heliossíncrona de 550 km, com 6 imagens multiespectrais por dia.", "PDR §1 Missão"],
    ["orbit", "horizonte1-pdr", "Órbita heliossíncrona, altitude 550 km, inclinação 97,6°, período 95,6 min, fração de eclipse máxima 36 %.", "PDR §2 Órbita"],
    ["lifetime", "horizonte1-pdr", "Tempo de vida orbital estimado em 8,5 anos para a massa e área frontal de referência; o limite regulatório de reentrada é 25 anos.", "PDR §2.3 Reentrada"],
    ["architecture", "horizonte1-pdr", "Subsistemas: EPS, COMMS, OBC, ADCS, Estrutura, Controle térmico e Carga útil.", "PDR §3 Arquitetura"],
    ["solar", "horizonte1-budgets", "Painéis solares fixos nas quatro faces laterais 2U: geração média orbital de 2,4 W (cenário pior caso, sem apontamento ao Sol). Massa 380 g.", "Orçamentos §1 Geração"],
    ["battery", "horizonte1-budgets", "Pacote de baterias 2S2P Li-ion, 7,4 V nominal, 38 Wh, faixa de operação 6,0–8,4 V. Massa 260 g. Temperatura mínima de carga 0 °C.", "Orçamentos §2 Armazenamento"],
    ["pcdu", "horizonte1-budgets", "Unidade de condicionamento e distribuição (PCDU): conversores para barramentos de 3,3 V (até 4 W) e 5 V (até 6 W); consumo próprio 0,08 W; massa 90 g.", "Orçamentos §3 Distribuição"],
    ["rail-3v3", "horizonte1-budgets", "Barramento 3,3 V: alimenta OBC, rádio UHF e controlador ADCS. Potência disponível 4 W.", "Orçamentos §3.1"],
    ["rail-5v", "horizonte1-budgets", "Barramento 5 V: alimenta câmera, magnetorquers e aquecedor. Potência disponível 6 W.", "Orçamentos §3.2"],
    ["obc", "horizonte1-budgets", "Computador de bordo: consumo contínuo 0,35 W; massa 65 g.", "Orçamentos §4 OBC"],
    ["radio", "horizonte1-budgets", "Transceptor UHF: 3,5 W em transmissão, 0,20 W em recepção, ciclo de transmissão 5 % da órbita (passagens sobre a estação). Massa 85 g. Taxa de dados 9,6 kbps.", "Orçamentos §5 COMMS"],
    ["antenna", "horizonte1-budgets", "Antena UHF desdobrável de fita: massa 90 g.", "Orçamentos §5.1"],
    ["radio-average-rule", "horizonte1-budgets", "Potência média do rádio = P_tx × ciclo_tx + P_rx × (1 − ciclo_tx).", "Orçamentos §5.2 Regra"],
    ["adcs-controller", "horizonte1-budgets", "Controlador ADCS com magnetômetro, sensores solares e giroscópio: 0,30 W contínuo; massa 110 g.", "Orçamentos §6 ADCS"],
    ["magnetorquers", "horizonte1-budgets", "Três magnetorquers: 0,60 W quando ativos, ciclo de atuação 40 %; massa 120 g.", "Orçamentos §6.1"],
    ["pointing", "horizonte1-pdr", "Apontamento nadir com precisão de 3,2° (3σ) na configuração de referência; o desempenho depende do desvio entre o centro de massa e o centro geométrico.", "PDR §5 ADCS"],
    ["com", "horizonte1-pdr", "Centro de massa de referência a 4 mm do centro geométrico (requisito do lançador: ≤ 20 mm). Cada componente alterado exige nova análise de balanceamento.", "PDR §6.2 Balanceamento"],
    ["frame", "horizonte1-budgets", "Estrutura 2U em alumínio 6061 com trilhos anodizados: massa 320 g. Chicote e fixações: 150 g.", "Orçamentos §7 Estrutura"],
    ["heater", "horizonte1-budgets", "Aquecedor das baterias: 0,90 W quando ativo, ciclo 15 % nas fases de eclipse; massa 20 g.", "Orçamentos §8 Térmico"],
    ["thermal", "horizonte1-pdr", "A câmera é acoplada termicamente à estrutura; dissipação acima de 3 W exige análise térmica dedicada do trilho de montagem.", "PDR §7 Térmico"],
    ["camera", "horizonte1-budgets", "Câmera multiespectral de 4 bandas: 1,8 W durante a captura, ciclo de operação 6 % da órbita; massa 240 g; resolução no solo 22 m a 550 km.", "Orçamentos §9 Carga útil"],
    ["data", "horizonte1-pdr", "Volume de dados: 6 imagens/dia × 18 MB = 108 MB/dia; o enlace UHF de 9,6 kbps transfere no máximo 42 MB/dia nas passagens previstas.", "PDR §8 Dados"],
    ["active-load-rule", "horizonte1-budgets", "Cargas cíclicas entram no orçamento pela potência média = potência ativa × ciclo de operação.", "Orçamentos §10.1 Regra"],
    ["budget-rule", "horizonte1-budgets", "Orçamento de potência = soma das potências médias × 1,2 (margem de projeto).", "Orçamentos §10.2 Regra"],
    ["balance-rule", "horizonte1-budgets", "Balanço de energia = geração média orbital − orçamento de potência.", "Orçamentos §10.3 Regra"],
    ["mass-rule", "horizonte1-budgets", "Orçamento de massa = soma das massas dos componentes.", "Orçamentos §11 Regra"],
    ["requirements", "horizonte1-pdr", "Requisitos de missão: MI-001 massa total ≤ 2200 g (alocação do lançador); MI-002 margem de potência ≥ 0 W; MI-003 apontamento ≤ 5°; MI-004 reentrada ≤ 25 anos; MI-005 resolução no solo ≤ 30 m; MI-006 enviar ≥ 100 MB/dia.", "PDR §9 Requisitos"]
  ],
  system: ({ prop, entity, relation, requirement }) => ({
    entities: [
      entity("system", "Horizonte-1", "system", undefined, ["mission", "architecture"], [], "CubeSat 2U de observação da Terra para monitoramento agrícola."),
      entity("orbit", "Órbita e tempo de vida", "performance", "system", ["orbit", "lifetime"], [prop("altitude", 550, "km", "orbit"), prop("eclipse_fraction", 36, "%", "orbit"), prop("orbital_lifetime", 8.5, "anos", "lifetime", "tempo de vida orbital")], "Heliossíncrona, 550 km. O tempo de vida depende da massa e da área frontal."),
      entity("eps", "EPS", "subsystem", "system", ["architecture"], [], "Geração, armazenamento e distribuição de energia."),
      entity("solar", "Painéis solares", "component", "eps", ["solar"], [prop("generated_power", 2.4, "W", "solar"), prop("mass", 380, "g", "solar")], "Quatro painéis fixos nas faces laterais."),
      entity("battery", "Pacote de baterias", "component", "eps", ["battery"], [prop("capacity", 38, "Wh", "battery"), prop("nominal_voltage", 7.4, "V", "battery"), prop("minimum_voltage", 6, "V", "battery"), prop("maximum_voltage", 8.4, "V", "battery"), prop("mass", 260, "g", "battery")], "2S2P Li-ion."),
      entity("pcdu", "PCDU", "component", "eps", ["pcdu"], [prop("operating_power", 0.08, "W", "pcdu"), prop("mass", 90, "g", "pcdu")], "Condicionamento e distribuição de energia."),
      entity("rail-3v3", "Barramento 3,3 V", "interface", "eps", ["rail-3v3"], [prop("output_voltage", 3.3, "V", "rail-3v3"), prop("available_power", 4, "W", "rail-3v3")]),
      entity("rail-5v", "Barramento 5 V", "interface", "eps", ["rail-5v"], [prop("output_voltage", 5, "V", "rail-5v"), prop("available_power", 6, "W", "rail-5v")]),
      entity("power-budget", "Orçamento de potência", "calculation", "eps", ["budget-rule"], [prop("formula", "sum_power", undefined, "budget-rule"), prop("power_margin_multiplier", 1.2, "1", "budget-rule")]),
      entity("energy-balance", "Balanço de energia", "performance", "eps", ["balance-rule"], [prop("formula", "energy_balance", undefined, "balance-rule")]),
      entity("comms", "COMMS", "subsystem", "system", ["architecture"], [], "Enlace UHF com a estação de solo."),
      entity("radio", "Transceptor UHF", "component", "comms", ["radio"], [prop("tx_power", 3.5, "W", "radio"), prop("rx_power", 0.2, "W", "radio"), prop("tx_duty_cycle", 5, "%", "radio"), prop("data_rate", 9.6, "kbps", "radio"), prop("mass", 85, "g", "radio")]),
      entity("antenna", "Antena UHF", "component", "comms", ["antenna"], [prop("mass", 90, "g", "antenna")], "Antena de fita desdobrável."),
      entity("comms-average", "Potência média COMMS", "calculation", "comms", ["radio-average-rule"], [prop("formula", "duty_cycle_power", undefined, "radio-average-rule")]),
      entity("data-volume", "Volume de dados diário", "performance", "comms", ["data"], [prop("generated_data", 108, "MB/dia", "data"), prop("downlink_capacity", 42, "MB/dia", "data")], "Imagens geradas versus capacidade do enlace."),
      entity("obc", "Computador de bordo", "component", "system", ["obc"], [prop("operating_power", 0.35, "W", "obc"), prop("mass", 65, "g", "obc")]),
      entity("adcs", "ADCS", "subsystem", "system", ["architecture"], [], "Determinação e controle de atitude."),
      entity("adcs-controller", "Controlador ADCS", "component", "adcs", ["adcs-controller"], [prop("operating_power", 0.3, "W", "adcs-controller"), prop("mass", 110, "g", "adcs-controller")], "Magnetômetro, sensores solares e giroscópio."),
      entity("magnetorquers", "Magnetorquers", "component", "adcs", ["magnetorquers"], [prop("operating_power", 0.6, "W", "magnetorquers"), prop("duty_cycle", 40, "%", "magnetorquers"), prop("mass", 120, "g", "magnetorquers")]),
      entity("magnetorquers-average", "Potência média ADCS", "calculation", "adcs", ["active-load-rule"], [prop("formula", "duty_cycle_load", undefined, "active-load-rule")]),
      entity("pointing", "Apontamento", "performance", "adcs", ["pointing"], [prop("pointing_accuracy", 3.2, "°", "pointing")], "Precisão de apontamento nadir; sensível ao centro de massa."),
      entity("structure", "Estrutura", "subsystem", "system", ["architecture"], [], "Estrutura mecânica, montagem e balanceamento."),
      entity("frame", "Estrutura 2U", "component", "structure", ["frame"], [prop("mass", 320, "g", "frame")], "Alumínio 6061 com trilhos anodizados."),
      entity("harness", "Chicote e fixações", "component", "structure", ["frame"], [prop("mass", 150, "g", "frame")]),
      entity("mass-budget", "Orçamento de massa", "calculation", "structure", ["mass-rule"], [prop("formula", "sum_mass", undefined, "mass-rule")]),
      entity("center-of-mass", "Centro de massa", "performance", "structure", ["com"], [prop("com_offset", 4, "mm", "com", "desvio do centro geométrico"), prop("maximum_offset", 20, "mm", "com")], "Desvio em relação ao centro geométrico."),
      entity("thermal", "Controle térmico", "subsystem", "system", ["architecture"], [], "Aquecimento das baterias e acoplamento da carga útil."),
      entity("heater", "Aquecedor das baterias", "component", "thermal", ["heater"], [prop("operating_power", 0.9, "W", "heater"), prop("duty_cycle", 15, "%", "heater"), prop("mass", 20, "g", "heater")]),
      entity("heater-average", "Potência média do aquecedor", "calculation", "thermal", ["active-load-rule"], [prop("formula", "duty_cycle_load", undefined, "active-load-rule")]),
      entity("payload", "Carga útil", "subsystem", "system", ["architecture"], [], "Imageamento multiespectral."),
      entity("camera", "Câmera multiespectral", "component", "payload", ["camera"], [prop("operating_power", 1.8, "W", "camera"), prop("duty_cycle", 6, "%", "camera"), prop("mass", 240, "g", "camera"), prop("ground_resolution", 22, "m", "camera", "resolução no solo")], "Quatro bandas, captura durante 6 % da órbita."),
      entity("camera-average", "Potência média da câmera", "calculation", "payload", ["active-load-rule"], [prop("formula", "duty_cycle_load", undefined, "active-load-rule")])
    ],
    relations: [
      relation("solar-pcdu", "solar", "pcdu", "powers", ["pcdu"]),
      relation("battery-pcdu", "battery", "pcdu", "powers", ["pcdu"]),
      relation("pcdu-3v3", "pcdu", "rail-3v3", "powers", ["rail-3v3"]),
      relation("pcdu-5v", "pcdu", "rail-5v", "powers", ["rail-5v"]),
      ...["obc", "radio", "adcs-controller"].map((id) => relation(`3v3-${id}`, "rail-3v3", id, "powers", ["rail-3v3"])),
      ...["camera", "magnetorquers", "heater"].map((id) => relation(`5v-${id}`, "rail-5v", id, "powers", ["rail-5v"])),
      relation("comms-average-input", "comms-average", "radio", "derived_from", ["radio-average-rule"]),
      relation("magnetorquers-average-input", "magnetorquers-average", "magnetorquers", "derived_from", ["active-load-rule"]),
      relation("heater-average-input", "heater-average", "heater", "derived_from", ["active-load-rule"]),
      relation("camera-average-input", "camera-average", "camera", "derived_from", ["active-load-rule"]),
      ...["obc", "pcdu", "adcs-controller", "comms-average", "magnetorquers-average", "heater-average", "camera-average"].map((id) => relation(`${id}-budget`, id, "power-budget", "contributes_to", ["budget-rule"])),
      relation("balance-generation", "energy-balance", "solar", "derived_from", ["balance-rule"]),
      relation("balance-demand", "energy-balance", "power-budget", "derived_from", ["balance-rule"]),
      relation("balance-battery", "energy-balance", "battery", "affects", ["battery"], "inferred"),
      ...["solar", "battery", "pcdu", "obc", "radio", "antenna", "adcs-controller", "magnetorquers", "frame", "harness", "heater", "camera"].map((id) => relation(`${id}-mass`, id, "mass-budget", "contributes_to", ["mass-rule"])),
      relation("com-mass", "center-of-mass", "mass-budget", "derived_from", ["com"]),
      relation("pointing-com", "pointing", "center-of-mass", "depends_on", ["pointing"]),
      relation("pointing-magnetorquers", "pointing", "magnetorquers", "depends_on", ["pointing"]),
      relation("lifetime-mass", "orbit", "mass-budget", "derived_from", ["lifetime"]),
      relation("lifetime-area", "orbit", "solar", "derived_from", ["lifetime"]),
      relation("camera-frame", "camera", "frame", "mounted_on", ["thermal"]),
      relation("camera-thermal", "camera", "frame", "thermal_coupling", ["thermal"]),
      relation("battery-heater", "heater", "battery", "affects", ["battery"]),
      relation("data-camera", "data-volume", "camera", "derived_from", ["data"]),
      relation("data-radio", "data-volume", "radio", "constrained_by", ["data"])
    ],
    requirements: [
      requirement("MI-001", "Massa total", "A massa total do satélite não deve exceder 2200 g, alocação contratada com o lançador.", "Missão", ["Estrutura"], ["mass-budget"], [prop("maximum_mass", 2200, "g", "requirements")]),
      requirement("MI-002", "Margem de potência", "A geração média orbital deve cobrir o orçamento de potência com margem ≥ 0 W.", "Missão", ["EPS"], ["energy-balance"], [prop("minimum_power_margin", 0, "W", "requirements")]),
      requirement("MI-003", "Apontamento", "O apontamento nadir deve ter erro ≤ 5° (3σ) durante a captura de imagens.", "Missão", ["ADCS"], ["pointing"], [prop("maximum_pointing_error", 5, "°", "requirements")]),
      requirement("MI-004", "Reentrada", "O satélite deve reentrar em até 25 anos após o fim da missão.", "Regulatório", ["Órbita"], ["orbit"], [prop("maximum_orbital_lifetime", 25, "anos", "requirements")]),
      requirement("MI-005", "Resolução no solo", "As imagens devem ter resolução no solo ≤ 30 m.", "Carga útil", ["Carga útil"], ["camera"], [prop("maximum_ground_resolution", 30, "m", "requirements")]),
      requirement("MI-006", "Volume enviado", "O satélite deve enviar ≥ 100 MB de imagens por dia à estação de solo.", "Missão", ["COMMS"], ["data-volume", "radio"], [prop("minimum_daily_downlink", 100, "MB/dia", "requirements")])
    ]
  }),
  hypotheses: ({ user, change, card }) => ({
    cards: [
      card("idea-hyperspectral", "Trocar a câmera multiespectral por um imageador hiperespectral", "Substituir a câmera multiespectral por um imageador hiperespectral de 620 g, 9 W durante a captura, 8 % de ciclo de operação e resolução no solo de 28 m.",
        change("change-hyperspectral", "camera", "replace_component", "Imageador hiperespectral no lugar da câmera multiespectral: 620 g, 9 W em captura, 8 % de ciclo, 28 m de resolução.", [user("mass", 620, "g"), user("operating_power", 9, "W"), user("duty_cycle", 8, "%"), user("ground_resolution", 28, "m", "resolução no solo")], "Imageador hiperespectral")),
      card("idea-tx-duty", "Transmitir 20 % da órbita para enviar mais imagens", "Aumentar o ciclo de transmissão do rádio UHF de 5 % para 20 % da órbita, usando mais passagens sobre estações parceiras.",
        change("change-tx-duty", "radio", "parameter", "Ciclo de transmissão do rádio UHF de 5 % para 20 % da órbita.", [user("tx_duty_cycle", 20, "%")])),
      card("idea-deployable-panels", "Painéis solares desdobráveis para compensar o consumo", "Substituir os painéis fixos por dois painéis desdobráveis de duas faces: geração média orbital de 4,0 W e massa de 590 g.",
        change("change-deployable-panels", "solar", "parameter", "Painéis desdobráveis: geração média orbital de 4,0 W e massa de 590 g.", [user("generated_power", 4, "W"), user("mass", 590, "g")]), "draft"),
      card("idea-band-x", "E se o enlace fosse em banda S em vez de UHF?", undefined, undefined, "draft")
    ],
    links: [["idea-hyperspectral", "idea-deployable-panels"], ["idea-hyperspectral", "idea-tx-duty"], ["idea-tx-duty", "idea-band-x"]]
  })
};

/** In the order the team lists them; the lead index points into the six teammates (−1 = the visitor). */
export const DEMO_MISSIONS = [
  { ...AURORA, lead: -1 },
  { ...ATMOSFERA, lead: 0 },
  { ...ESTACAO, lead: 4 },
  { ...HORIZONTE, lead: -1 }
];
