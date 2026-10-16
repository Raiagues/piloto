# Interface de projetos e equipes

Revisão de 20/09/2026. As sugestões abaixo organizam o trabalho de equipes estudantis. Não substituem regulamentos, evidências técnicas ou a arquitetura extraída dos documentos.

## Decisões de interação

- Um cabeçalho em `App` mantém idioma, convites e perfil na mesma posição em todas as páginas autenticadas. O perfil não é montado novamente em cada página ou na lateral.
- Criação: nome, tipo e equipe; escolher uma competição revela modalidade e classe quando houver opções conhecidas. É possível decidir a classe depois. O objetivo não é solicitado nesse formulário; objetivos de projetos existentes continuam preservados.
- Setores: lista e organograma são apresentações alternativas. Renomear, adicionar, remover e ordenar são ações explícitas. Trocar a modalidade mantém o rascunho de setores de cada seleção durante o preenchimento.
- Equipe do projeto: lista paginada de pessoas, com participação por checkbox e edição de cargo/acessos no botão de opções. O popup usa controles de seleção e não um acordeão. Salvar configuração continua sendo a ação que persiste as alterações.
- Organograma: cartões agrupam o responsável e os participantes do setor, mantendo todas as pessoas. Ajuste automático, zoom e exportação SVG usam a mesma árvore de dados. Grandes equipes podem precisar de zoom para leitura; a lista oferece busca e paginação. Em telas pequenas, formulários têm rolagem vertical para manter controles legíveis.
- O painel da equipe é acessado pelo perfil, somente para usuários autorizados a gerenciar equipes. Os controles de atividade saem da memória do projeto. A autorização da API e a coleta de dados permanecem as mesmas.

A [pesquisa do Nielsen Norman Group sobre formulários](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/) orientou o agrupamento e os campos condicionais. As [diretrizes de tooltips](https://www.nngroup.com/articles/tooltip-guidelines/) fundamentam explicações curtas, opcionais, acessíveis por foco e toque; rótulos e erros necessários continuam visíveis. O [padrão de diálogo da W3C](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) orienta foco contido, Escape e retorno ao acionador nos novos popups.

## Pesquisa de setores e competições

Os agrupamentos são uma síntese para equipes pequenas, não uma estrutura oficial obrigatória. Gestão/patrocínios e integração/testes foram agrupados para evitar dezenas de departamentos.

| Modalidade | Sugestões adotadas | Fontes primárias |
| --- | --- | --- |
| Satélites / OBSAT prática | Estruturas; eletrônica e energia; software embarcado; comunicação; carga útil; testes e integração; gestão e patrocínios | [OBSAT: construção, programação e testes](https://wiki.obsat.org.br/books/modalidade-pratica/page/fase-2-construa-programe-teste-seu-satelite) |
| Foguetes | Aerodinâmica e estruturas; propulsão; aviônica; recuperação; carga útil; operações e testes; gestão | [NASA Student Launch](https://www.nasa.gov/learning-resources/nasa-student-launch/), [NASA: recuperação](https://www.nasa.gov/wp-content/uploads/2023/09/nasa-sl-2024-arw-recovery-systems-508.pdf), [equipe estudantil da Michigan](https://news.engin.umich.edu/2025/06/student-designed-engine-for-future-two-story-rocket-passes-final-engineering-milestone/) |
| AeroDesign | Aerodinâmica; estruturas; desempenho e estabilidade; propulsão; elétrica e controle; fabricação e testes; gestão | [Equipe da Tarleton](https://www.tarleton.edu/sae/competition/), [SAE Brasil: Regular, Advanced e Micro](https://legado.saebrasil.org.br/programas-estudantis/aero-design-sae-brasil/) |
| Fórmula SAE | Chassi; suspensão e direção; powertrain; elétrica e eletrônica; aerodinâmica; freios e ergonomia; gestão | [Colorado School of Mines: subsistemas](https://orgs.mines.edu/fsae/subsystems/), [SAE Brasil: classes Combustão e Elétrica](https://saebrasil.org.br/visao-geral/usp-sao-carlos-e-fei-sao-campeas-da-competicao-formula-sae-brasil-2026/) |
| Baja | Chassi e segurança; suspensão e direção; powertrain; freios; elétrica e instrumentação; fabricação e testes; gestão | [Nebraska Racing: subsistemas](https://nebraskaracing.unl.edu/baja/subsystems/) |

OBSAT teórica recebe estudos, pesquisa e gestão. LASC oferece as modalidades Rocket, Satellite e Lander confirmadas na [visão geral de 2026](https://www.lasc.space/2026-lasc/overview); Lander usa a sugestão genérica de engenharia, sem impor uma organização ainda não pesquisada. Categorias de apogeu/motor não foram inventadas. AeroDesign e Fórmula usam classes verificadas. Novas opções do catálogo não criam requisitos ou datas automaticamente: a documentação oficial continua sendo a referência.

## Verificação

`tests/organizationLayout.test.ts` cobre conteúdo preservado, cartões sem sobreposição, IDs repetidos entre projetos, defaults por modalidade e compatibilidade de dados antigos. Os scripts `test:visual:organization` e `test:visual:teams` cobrem os formulários reais, persistência de classe/setores, perfil único por rota, convite/aceite, popup de permissões, organograma dentro da janela, teclado, exportação e telas pequenas. Usam dados temporários e IA desativada.
