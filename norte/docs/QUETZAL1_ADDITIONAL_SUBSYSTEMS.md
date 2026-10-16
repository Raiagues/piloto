# Quetzal-1 — ampliação das fontes de arquitetura

Pesquisa em 08/09/2026. A extensão com melhor suporte público é **ADCS + ADM**, incluindo suas interfaces com EPS e OBC. O [pacote de quatro documentos](../examples/quetzal1/architecture-sources/README.md) inclui também uma visão geral publicada pela equipe. Extrações reais por documento foram aceitas pelo contrato e pela verificação dos trechos citados. A extensão de inicialização anexa as fontes e amplia o mapa existente sem substituir seus valores técnicos ou o programa escolhido.

## ADCS: determinação e controle de atitude

A equipe documenta controle magnético passivo e determinação por sensores. O documento descreve uma IMU BNO055, fotodiodos de Sol, conversores ADC e um microcontrolador, além da ligação com o EPS e isolamento do barramento I²C. Isso permite pesquisar blocos de controle, sensoriamento e interfaces sem presumir rodas de reação ou atuadores não documentados. [Fonte oficial de hardware](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/ADCS/README.md).

O software documenta comunicação com o OBC, inicialização tolerante a falhas e comandos para aquisição e reset. É evidência de interfaces reais entre subsistemas. A documentação informa uma configuração da IMU sem fusão embarcada; não se deve transformar isso em uma malha autônoma de apontamento. [Fonte oficial de software](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-flight-software/blob/dbfb67a2c8a7336f765e320d37a8a02e3ab4c212/ADCS/README.md).

## ADM: abertura das antenas

O documento descreve liberação de quatro antenas, temporização controlada pelo OBC, acionamento sequencial pelo EPS e detecção por interruptores. A mesma placa abriga o painel solar Z− e sensores de Sol. Isso fornece relações entre ADM, EPS, OBC e ADCS, além de distinguir função, montagem física e alimentação. [Fonte oficial ADM](https://github.com/Quetzal-1-CubeSat-Team/quetzal1-hardware/blob/d4d1b59de384701a016a6e17353aff3c8ba64853/ADM/README.md).

## Visão geral da missão

A [publicação de danalvarez sobre o projeto](https://hackaday.io/project/191065-open-sourcing-the-design-for-the-quetzal-1-cubesat) identifica OBC, transceptor, antena, EPS, ADCS, payload, ADM e estrutura. Dois trechos curtos fornecem a identificação dos blocos que faltavam. A extração registrada acrescenta os nomes; não atribui fabricante, orçamento ou desempenho a partir dessa lista. O agrupamento do EPS existente sob a raiz da missão é organizacional, sem criar relações físicas novas.

## Regras de uso e limites

- Cada entidade, propriedade e ligação extraída precisa citar trecho/localizador do arquivo efetivamente anexado. Nomes sugeridos de agrupamentos são interpretação, não nomenclatura oficial automaticamente confirmada.
- Usar relações distintas para conter, alimentar, comunicar e estar montado em. Compartilhar uma placa não torna dois subsistemas equivalentes.
- Os componentes explicitamente destinados a testes/desenvolvimento e não montados no modelo de voo devem permanecer separados da arquitetura de voo.
- OBC aparece como participante de interfaces nestas fontes. Isso não comprova seu hardware interno, fabricante, orçamento ou requisitos completos. A passagem sobre a câmera no ADM comprova uma restrição de montagem, não uma especificação completa de payload.
- Para comunicações/segmento de solo, a equipe também publica [gr-quetzal1](https://github.com/danalvarez/gr-quetzal1). Ele contém decodificação e visualização de beacons; requer seleção separada de especificações de protocolo antes de anexar. Não foi incluído neste pacote.
- Especificações detalhadas de estrutura, térmica e payload continuam lacunas de pesquisa, mesmo quando o nome do bloco aparece no mapa. Não preencher por analogia com outro CubeSat nem usar resultados pós-voo como requisitos de projeto.
- Fontes de fabricante são complementares. Verificar o componente/revisão exatos antes de atribuir limites ao componente que foi montado.

Os arquivos pequenos de texto permitem acrescentar contexto legível sem aumentar limites de requisição ou carregar repositórios completos. O contexto EPS existente e o gabarito de validação permanecem inalterados. A ampliação aditiva é aplicada uma vez no início do servidor ao projeto real existente. [Registro das extrações e limites](../examples/quetzal1/architecture-extraction/README.md). Reabrir a concepção não dispara novas extrações.
