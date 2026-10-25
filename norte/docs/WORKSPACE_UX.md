# Interface de projetos e equipes

Revisão de 24/10/2026. As decisões atuais organizam o trabalho de equipes e empresas. As referências de organização abaixo são pesquisa; não criam setores ou regras automaticamente.

## Decisões de interação

- Um cabeçalho em `App` mantém idioma, convites e perfil na mesma posição em todas as páginas autenticadas. O perfil não é montado novamente em cada página ou na lateral.
- O projeto oferece Requisitos, Verificação, Cronograma e Documentos. As áreas experimentais foram retiradas para todas as contas.
- Equipes mostram contas existentes e seus projetos. Cargo e função são gerenciados por quem tem autorização na equipe e aparecem somente para leitura no perfil pessoal.
- Contatos permite buscar e carregar mais resultados; respostas antigas não substituem uma busca mais recente.
- Navegação não grava snapshots inteiros do projeto. Cada ação confirma sua própria alteração e mantém as verificações de acesso no servidor.
- O perfil reúne identidade e vínculos profissionais. Não coleta campos acadêmicos ou horas disponíveis.

A [pesquisa do Nielsen Norman Group sobre formulários](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/) orientou o agrupamento e os campos condicionais. As [diretrizes de tooltips](https://www.nngroup.com/articles/tooltip-guidelines/) fundamentam explicações curtas, opcionais, acessíveis por foco e toque; rótulos e erros necessários continuam visíveis. O [padrão de diálogo da W3C](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) orienta foco contido, Escape e retorno ao acionador nos novos popups.

## Referências de organização

Os agrupamentos são uma síntese para equipes pequenas, não uma estrutura oficial obrigatória. Gestão/patrocínios e integração/testes foram agrupados para evitar dezenas de departamentos.

| Modalidade | Agrupamentos pesquisados | Fontes primárias |
| --- | --- | --- |
| Satélites / OBSAT prática | Estruturas; eletrônica e energia; software embarcado; comunicação; carga útil; testes e integração; gestão e patrocínios | [OBSAT: construção, programação e testes](https://wiki.obsat.org.br/books/modalidade-pratica/page/fase-2-construa-programe-teste-seu-satelite) |
| Foguetes | Aerodinâmica e estruturas; propulsão; aviônica; recuperação; carga útil; operações e testes; gestão | [NASA Student Launch](https://www.nasa.gov/learning-resources/nasa-student-launch/), [NASA: recuperação](https://www.nasa.gov/wp-content/uploads/2023/09/nasa-sl-2024-arw-recovery-systems-508.pdf), [equipe estudantil da Michigan](https://news.engin.umich.edu/2025/06/student-designed-engine-for-future-two-story-rocket-passes-final-engineering-milestone/) |
| AeroDesign | Aerodinâmica; estruturas; desempenho e estabilidade; propulsão; elétrica e controle; fabricação e testes; gestão | [Equipe da Tarleton](https://www.tarleton.edu/sae/competition/), [SAE Brasil: Regular, Advanced e Micro](https://legado.saebrasil.org.br/programas-estudantis/aero-design-sae-brasil/) |
| Fórmula SAE | Chassi; suspensão e direção; powertrain; elétrica e eletrônica; aerodinâmica; freios e ergonomia; gestão | [Colorado School of Mines: subsistemas](https://orgs.mines.edu/fsae/subsystems/), [SAE Brasil: classes Combustão e Elétrica](https://saebrasil.org.br/visao-geral/usp-sao-carlos-e-fei-sao-campeas-da-competicao-formula-sae-brasil-2026/) |
| Baja | Chassi e segurança; suspensão e direção; powertrain; freios; elétrica e instrumentação; fabricação e testes; gestão | [Nebraska Racing: subsistemas](https://nebraskaracing.unl.edu/baja/subsystems/) |

A [visão geral de 2026 da LASC](https://www.lasc.space/2026-lasc/overview) também foi consultada durante a pesquisa. Esses agrupamentos não são estruturas obrigatórias nem um catálogo ativo da aplicação; a documentação oficial de cada projeto continua sendo a referência.

## Verificação

`tests/organizationLayout.test.ts` cobre conteúdo preservado, cartões sem sobreposição e IDs repetidos entre projetos. `npm run test:visual` valida equipes, contatos, edição autorizada de cargo, perfil, rotas e versões desktop/mobile com armazenamento temporário e sem chamadas a modelos externos. Testes da API cobrem convites, revisão independente e revogação de permissões.
