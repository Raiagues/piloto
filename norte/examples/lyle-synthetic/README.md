# LYLE — insumos sintéticos e gabaritos

Este corpus foi preservado localmente para avaliação manual de rastreabilidade, generalização e resistência a instruções presentes em documentos. Entradas e gabaritos ficam fora do Git e da imagem Docker. Não é carregado pelo aplicativo nem pelas suítes atuais. Ele é separado do projeto criado a partir do documento original de `novo_teste`.

- `inputs/`: transcrições sintéticas das reuniões M1 (rastreabilidade) e M2 (confidencial simulado), uma variação de pauta parcial, um documento com instrução maliciosa e um documento novo para generalização. Pessoas, fornecedor e operações são fictícios. Os IDs de turnos (M1-T01…) localizam as evidências dos gabaritos; não representam páginas nem tempos de áudio. As cópias TXT, DOCX e PDF existentes preservam esses IDs.
- `evaluation_reference/`: gabaritos e localizadores para comparação externa. Não são enviados aos modelos nem usados pelo código de produção. Mantenha-os separados dos exemplos de correção ao construir uma avaliação.

O utilitário opcional [`scripts/build_lyle_synthetic.py`](../../../scripts/build_lyle_synthetic.py) recria DOCX com `python-docx`; `--audio` também exige Piper e uma voz local previamente instalada. Essas dependências de avaliação não fazem parte do `setup` do produto. O gerador antigo de PDF foi retirado; os PDFs já produzidos permanecem como fixtures. Não é preciso regenerá-los para usar o corpus.

Áudio sintético e seus metadados são gravados em `.runtime/synthetic-audio/`, fora do Git. O corpus não demonstra precisão em reuniões reais nem substitui uma avaliação rotulada por especialistas.
