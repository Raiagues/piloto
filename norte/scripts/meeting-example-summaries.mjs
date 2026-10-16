/** Editorial summaries of fictional fixtures only. Never inference or project evidence. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const Session = createRequire(import.meta.url)('../../meeting-session.js');
const summaries = {
  geral: {
    2: 'APP-04: versão 12 abre em 3,4 s; limite 2 s na rede de 4 Mbps.',
    3: 'Sensores: Alfa R$ 180/un., 8 dias úteis; Beta R$ 215/un., 3 dias úteis.',
    5: 'Demonstração exige 2 sensores; lote de 10 destinado aos ensaios seguintes.',
    6: 'Hipótese: imagens sem compressão atrasam a abertura; ainda sem medição.',
    7: 'Laboratório pendente; Diego confirma disponibilidade até amanhã, 12h.',
    10: 'Versão 13: mediana 1,8 s em 5 execuções, mesma rede (TEST-APP-13).',
    11: 'Homologação exige 30 execuções; faltam 25.',
    12: 'Versão 13 atende nas 5 medições; homologação completa pendente.',
    13: 'Beta: 2 sensores R$ 430; lote de 10 R$ 2.150 supera orçamento R$ 1.900.',
    15: 'Roteiro proposto: problema → sensor → aplicativo; Diego faz 3 slides até quinta, 17h.',
    17: 'Autonomia medida: 4h40; abaixo das 6h exigidas por EN-02.',
    19: 'Hipótese: enviar dados a cada 5 s em vez de 1 s, mantendo atualização útil.',
    20: 'Bruno compara frequências com a mesma bateria até terça; registrar configurações.',
    22: 'Contraste atual 3,1:1; abaixo do mínimo 4,5:1 de UI-07.',
    24: 'Clara mede a nova cor e anexa referência até amanhã, 16h.',
    25: 'Aprovados 2 sensores Beta por R$ 430; outros 8 sem autorização.',
    26: 'Novo contraste 5,2:1 atende 4,5:1 nessa combinação (TEST-UI-08).',
    27: 'Laboratório reservado para sexta, 9h; referência LAB-19.',
    28: 'Ensaio sexta, 9h; demonstração sexta, 10h. Cancelado ensaio de quinta.',
    29: 'Entrega Beta até sexta à noite não garante sensores para demonstração às 10h.',
    31: 'Firmware 2.1: conexão estável por 20 min; firmware 2.0 não testado.',
    32: 'Demonstração usará 2 sensores antigos, firmware 2.1; novos ficam para ensaios.',
    33: 'Total aprovado corrigido: sensores R$ 430 + cabos R$ 120 = R$ 550.',
    35: 'Confirmar cabos de 2 m; R$ 120 é orçamento, recebimento não confirmado.',
    38: 'Clara fará 25 execuções até quarta; acima de 2 s não há aprovação automática.',
    40: 'Ana envia foto do equipamento sem pessoas identificáveis amanhã, 11h.',
    41: 'Carregador atingiu 58 °C; fabricante permite até 45 °C.',
    42: 'Causa do aquecimento não comprovada; medir corrente e ventilação.',
    43: 'Demonstração usará fonte certificada de 12,0 V, sem o carregador.',
    44: 'Aquecimento segue em aberto; Bruno abre diagnóstico para quinta.',
    48: 'Incidentes da demonstração serão tratados no grupo atual da equipe.',
    50: 'Áudio testado no notebook; conexão com projetor ainda pendente.',
    51: 'Testar áudio no ensaio das 9h; se falhar, seguir sem vídeo narrado.',
    54: 'Versão 13 aprovada para demonstração; homologação aguarda mais 25 execuções.',
    57: 'Economia por mudança de frequência segue hipótese; autonomia ainda não medida.',
    59: 'Enviar pedido e obter confirmação do fornecedor; aprovação interna concluída.',
  },
  setor: {
    2: 'V1: flecha 3,8 mm sob 100 N; comprimento 600 mm, seção 20 × 10 mm.',
    3: 'EST-04: flecha máxima 2,0 mm; V1 reprovada, causa ainda incerta.',
    5: 'Carenagem A: estimativa CAD 420 g; acima dos 400 g de MASS-02.',
    8: 'Testar parede de 1,6 mm em vez de 2,0 mm; lote ainda não autorizado.',
    9: 'V1 simulada: 2,9 mm; fixação ideal difere do ensaio físico de 3,8 mm.',
    10: 'V2, altura 14 mm: primeira flecha 1,9 mm; apenas uma repetição.',
    11: 'TEST-EST-07 exige 3 repetições e maior flecha; V2 ainda não aprovada.',
    12: 'Bia repete 2 ensaios amanhã, 14h; Rui verifica torque antes.',
    13: 'Folga do sensor 0,45 mm; acima dos 0,30 mm de TOL-03.',
    14: 'Folga: possível retração ou erro de medida; medir peça e sensor separadamente.',
    15: 'Sensor 12,00 mm e alojamento 12,45 mm confirmam folga, sem provar causa.',
    16: 'Proposta B: alojamento de 12,20 mm; ensaiar antes de liberar produção.',
    17: 'Carenagem B, parede 1,6 mm: CAD estima 356 g; pesagem pendente.',
    19: 'Usinagem: V2 cotada R$ 260, V1 custou R$ 190; teto R$ 300.',
    21: 'V2, segundo ensaio: flecha 2,2 mm supera limite 2,0 mm.',
    22: 'V2, terceiro ensaio 2,1 mm; máxima 2,2 mm não atende EST-04.',
    23: 'Torque 4 N·m nas 3 repetições; anexar incerteza do comparador.',
    24: 'V2 reprovada por flecha; incerteza documental continua pendente.',
    25: 'Proposta V3: altura 16 mm, comprimento 600 mm, carga 100 N; sem resultado.',
    27: 'Encaixe B: 12,23 − 12,00 = 0,23 mm; atende limite 0,30 mm.',
    28: 'Encaixe B aprovado para protótipo (TEST-TOL-09); outras peças não aprovadas.',
    29: 'Carenagem B: massa medida 372 g; CAD previa 356 g, limite 400 g.',
    30: 'Carenagem B trincou na 3ª montagem; falha local apesar da massa adequada.',
    31: 'MAN-01 exige 10 montagens sem trinca; carenagem B não aprovada.',
    32: 'Hipótese C: reforçar parafuso e manter parede de 1,6 mm no restante.',
    33: 'Carenagem C: CAD estima 389 g; conformidade com 400 g ainda não confirmada.',
    34: 'V3 simulada: flecha 1,4 mm; ensaio físico ainda pendente.',
    35: 'V3 cotada R$ 285, entrega quinta, 15h; ensaio precisa ir para sexta.',
    36: 'Autorizada 1 V3 por R$ 285; Rui pede hoje, Bia testa sexta, 9h.',
    38: 'Carenagem C pesada: 397 ± 2 g; estimativa CAD era 389 g.',
    40: 'Carenagem C aprovada: 10 montagens sem trinca, MASS-02 e MAN-01 (TEST-CAR-12).',
    41: 'Verificar montagem da carenagem C com V3; aprovações isoladas não bastam.',
    42: 'CAD: interferência de 0,6 mm entre V3 e nervura da carenagem C.',
    43: 'Proposta D: deslocar nervura 1,0 mm e repetir checagem de montagem.',
    44: 'Manter V3 encomendada; Caio confirma montagem digital da D amanhã, 11h.',
    46: 'Torque final permanece 4 N·m; sugestão de 6 N·m não aprovada.',
    47: 'CAD: carenagem D e V3 têm folga mínima 0,4 mm; montagem física pendente.',
    48: 'Interferência digital resolvida; verificar fisicamente sexta, com ensaio V3.',
    49: 'Pedido V3 enviado e confirmado; entrega física prevista para quinta.',
    50: 'V3 sob 100 N: 1,7 / 1,8 / 1,7 mm; máxima 1,8 atende limite 2,0 mm.',
    52: 'V3 aprovada pelo EST-04 apenas na configuração testada.',
    53: 'Montagem física D + V3: folga 0,35 mm, sem contato (TEST-CONJ-16).',
    54: 'Carenagem D: 398 ± 2 g; atende limite 400 g, sem margem adicional.',
    55: 'Repetir 10 montagens da D; teste da C não encerra essa pendência.',
    56: 'V3 e encaixe B aprovados; D atende massa e encaixe, manuseio pendente.',
    57: 'Caio fará 10 montagens da D até segunda, 15h; compra V3 já concluída.',
  },
};
const fixtures = Object.entries(summaries).map(([kind, values]) => ({ values, entries: Session.parseTranscriptEntries(readFileSync(new URL(`../public/meeting-mocks/${kind}-25min.txt`, import.meta.url), 'utf8')) }));
export function withPreparedExampleSummaries(snapshot) {
  const copy = structuredClone(snapshot);
  if (!copy.meeting_metadata?.example) return copy;
  for (const event of copy.meeting_events || []) {
    if (event.source !== 'fictional_curated_example' || event.summary) continue;
    const index = Number(/^E(\d+)$/.exec(event.event_id)?.[1]) - 1;
    const fixture = fixtures.find(item => item.entries[index]?.text === event.text && item.values[index]);
    if (fixture) { event.summary = fixture.values[index]; event.summary_source = event.text; event.summary_origin = 'prepared_example'; }
  }
  return copy;
}
