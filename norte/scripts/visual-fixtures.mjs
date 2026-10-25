// Generic UI data authored for isolated smokes; no private project source.
const rows = [
  ['Registro de leitura', 'O equipamento deve registrar cada leitura com uma marca de tempo.', 'Aquisição'],
  ['Unidade de medida', 'Cada leitura registrada deve indicar a unidade de medida.', 'Aquisição'],
  ['Consulta por período', 'A interface deve permitir consultar registros por período.', 'Interface'],
  ['Identificação de versão', 'A interface deve exibir a versão do software em execução.', 'Interface'],
  ['Exportação de registros', 'O serviço deve exportar os registros selecionados em formato CSV.', 'Dados'],
  ['Identificação de origem', 'Cada registro deve identificar o dispositivo que forneceu a leitura.', 'Dados'],
  ['Confirmação de configuração', 'O equipamento deve confirmar a aplicação de cada configuração.', 'Controle'],
  ['Registro de falha', 'O equipamento deve registrar o código de cada falha detectada.', 'Controle'],
];

export function visualRequirements() {
  const requirements = rows.map(([title, statement, subsystem], index) => ({
    id: `VIS-${String(index + 1).padStart(3, '0')}`,
    title,
    statement,
    subsystem,
    paragraph: index + 1,
    sourceLocator: `Parágrafo ${index + 1}`,
    comments: [{ text: 'Confirmar o critério de aceitação durante a revisão.' }],
  }));
  return {
    name: 'Projeto de validação',
    requirements,
    paragraphs: requirements.map(item => ({ paragraph: item.paragraph, text: item.statement })),
  };
}
