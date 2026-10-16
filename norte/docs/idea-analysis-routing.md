# Roteamento da análise de ideias

O envio começa na prévia autorizada da sessão. A confirmação usa o mesmo digest, revisão da ideia, memória, permissões e contexto de correções. Uma mudança nesse contexto exige outra prévia. A análise produz uma proposta temporária; não modifica a configuração aprovada.

O servidor consulta primeiro o cache compatível com esse contexto. Sem cache, `fastInterpreter` tenta o Jev para uma alteração absoluta simples: uma quantidade suportada e um alvo identificável. Uma correspondência completa de nome, título ou ID recebe prioridade sobre palavras incidentais de propriedades. Nomes completos duplicados, dois alvos explícitos e rótulos genéricos como “Camera” quando também existe “Camera reserva” continuam ambíguos. O schema atual não possui aliases de entidade; a seleção não cria sinônimos a partir da descrição.

No caminho rápido, o Jev recebe o texto e um inventário pequeno, escolhe o alvo/propriedade com opções fechadas e pode recusar com `none`. A aceitação exige confiança mínima de 0,8, margem de 0,25 e distribuição de probabilidades válida. A quantidade vem do texto original; o validador confere propriedade, unidade, origem e ausência de alterações adicionais. O modelo não calcula nem aprova impacto físico.

Se a entrada não cabe nesse contrato, a escolha é incerta ou o Jev falha, o fluxo segue para o Gemini. Alterações relativas, negação, citações, múltiplas quantidades, unidades não reconhecidas e contexto extenso são exemplos desse caminho. O Gemini recebe contexto selecionado do mapa autorizado, com as referências e seus limites; a prévia pode conter mais dados do que a seleção enviada. A interpretação também passa pelo validador antes de virar proposta. Essa etapa usa uma tentativa com prazo de 60 segundos, sem repetição automática.

## Configuração

Não existe uma flag `NORTE_JEV_FAST_INTERPRET`. `buildApp` conecta `fastInterpreter` por padrão. O cliente Jev exige uma URL HTTP local em `NORTE_MEETING_BACKEND_URL` e `NORTE_MEETING_BRIDGE_SECRET` com pelo menos 32 caracteres; o supervisor configura ambos. O worker usa `TYPESAFE_API_KEY` para a API oficial. Configurar a ponte não comprova acesso ou saldo no provedor: uma falha real ainda pode provocar fallback.

O modelo de interpretação pode ser separado do modelo usado nas atas:

```dotenv
GEMINI_DISCOVERY_MODEL=gemini-3.5-flash-lite
GEMINI_DISCOVERY_THINKING_LEVEL=minimal
GEMINI_MODEL=gemini-3.8-flash
```

As duas funções usam a mesma chave Google. Sem `GEMINI_DISCOVERY_MODEL`, a interpretação herda `GEMINI_MODEL`; sem ambos, usa o padrão do módulo. O código não fixa a interpretação em `gemini-3.8-flash`. A escolha mais barata precisa continuar sendo avaliada com hipóteses representativas.

## Evidência de validação

Em 16/10/2026, uma análise real isolada usou `gemini-3.8-flash`, herdado do `.env` daquele processo, porque o modelo específico de discovery estava ausente. A prévia continha 87 entidades, 54 relações, 221 evidências e 17 documentos públicos. O resultado preservou o alvo e a única quantidade solicitada; a configuração original permaneceu intacta. Foram usados uma chamada real e nenhum retry. Isso valida o fluxo daquela hipótese, não a acurácia geral nem o impacto físico.

A investigação identificou um fallback desnecessário: o texto `operating_power` era dividido em palavras que também nomeavam componentes “Power”. A regressão local agora confirma que o nome completo único dos resistores seleciona apenas esse alvo antes da chamada Jev; o identificador da propriedade deixa de criar candidatos adicionais. Essa regressão usa respostas simuladas, sem novas chamadas pagas. Teste: `node --test server/fast-discovery.test.mjs`.
