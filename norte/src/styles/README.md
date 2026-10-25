# Estilos do Norte

`index.css` é a única entrada global. Carrega tokens claros, base acessível, componentes compartilhados e layout antes de qualquer rota assíncrona.

- `tokens.css`: cores semânticas e raios. Claro é o padrão; o seletor de tema escuro requer preferência explícita. A sala de reuniões também usa esta paleta.
- `base.css`: tipografia, rolagem, controles e foco com baixa especificidade. `!important` fica restrito à preferência de movimento reduzido.
- `layout.css` e `sidebar.css`: cabeçalho, conta e navegação persistente.
- `components.css`: controles compartilhados de páginas, busca, tabelas e formulários. Defaults usam `:where` para permitir que o componente defina sua aparência.
- `features/`: estilos importados pelos componentes/páginas responsáveis: conta, autenticação, equipes, contatos, mensagens, projetos, documentos institucionais e reuniões.
- Os demais módulos de engenharia (`delivery`, `requirements-workspace`, `schedule-*`, `document-library`, `evidence`) são importados pelos próprios componentes.

Edite a regra original no módulo responsável. Evite folhas de correção, estilos globais de botões com alta especificidade e seletores `#root` para vencer componentes. Use os tokens `--norte-*`; cores de informação (sucesso, atenção, erro) conservam significado nos dois temas. Ordene os breakpoints do maior para o menor.
