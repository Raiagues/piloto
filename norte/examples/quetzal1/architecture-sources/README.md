# Fontes adicionais de arquitetura — Quetzal-1

Quatro fontes preparadas em 08/09/2026 como **documentos do projeto**, com extrações reais do Gemini registradas em [architecture-extraction](../architecture-extraction/README.md). No próximo início do servidor, a extensão adiciona os documentos e mescla os fragmentos verificados ao projeto real existente `quetzal1-eps-comms`. Não cria um projeto demonstrativo nem altera a seleção do OBSAT. Este README, o manifesto e as licenças não são entradas de engenharia.

| Arquivo | Conteúdo de projeto | Origem |
| --- | --- | --- |
| [ADCS-hardware.txt](ADCS-hardware.txt) | Controle magnético passivo, sensores, isolamento I²C, alimentação e montagem dos interruptores de implantação. | [Hardware ADCS oficial](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/ADCS/README.md) |
| [ADCS-software.txt](ADCS-software.txt) | Rede interna de sensores, comandos OBC–ADCS, inicialização, configuração da IMU e interface de reset do ADM. | [Software ADCS oficial](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-flight-software/blob/dbfb67a2c8a7336f765e320d37a8a02e3ab4c212/ADCS/README.md) |
| [ADM-hardware.txt](ADM-hardware.txt) | Abertura de antenas, sequência comandada pelo OBC/EPS, detecção de abertura e placa compartilhada com painel solar. | [Hardware ADM oficial](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/ADM/README.md) |

| [MISSION-overview.txt](MISSION-overview.txt) | Identificação do OBC, transceptor, antena, payload, ADM e estrutura. | [Descrição publicada por danalvarez, da equipe da missão](https://hackaday.io/project/191065-open-sourcing-the-design-for-the-quetzal-1-cubesat) |

Os textos são recortes identificados de documentação oficial, mantendo a redação original. Removidos: apresentação de diretórios, imagens, bibliografia e referências a resultados em órbita. Links relativos foram tornados absolutos. O cabeçalho de cada arquivo identifica a adaptação, autoria, revisão e licença. Os hashes do original e do recorte estão em [manifest.json](manifest.json). Licenças dos repositórios em [licenses](licenses). A visão geral contém somente dois pequenos trechos atribuídos, com a omissão intermediária identificada e copyright mantido pelo autor.

Essas fontes descrevem implementação real, incluindo decisões feitas antes do voo. Não contêm séries de telemetria, resultados pós-voo, gabarito, relatórios de benchmark ou arquitetura pré-fabricada. A configuração usada em voo não deve ser confundida com desempenho observado durante o voo. A preparação não altera o contexto congelado do benchmark nem `docs/VALIDATED.md`.

A extensão é única e aditiva: valida tamanho/hash dos arquivos, contrato dos fragmentos e correspondência das citações antes de gravar. Preserva valores técnicos, cenários e programa; arquiva o modelo e as posições anteriores em `sourceExtensionHistory`. Reorganiza as posições do mapa para acomodar os novos ramos. Um marcador impede reaplicação e respeita remoções posteriores feitas pelo usuário. Projetos sem a proveniência real do EPS não são alterados. Se o projeto ainda não possui arquitetura, apenas os documentos são anexados; a inicialização normal pela IA continua necessária.

Abrir concepção continua preservando a arquitetura salva. Esta extensão específica não reintroduz releitura automática de quaisquer novos documentos, benchmark ou botão de revisão. Os `.txt` também podem ser anexados manualmente a outros projetos, mas isso não importa os fragmentos registrados automaticamente.
