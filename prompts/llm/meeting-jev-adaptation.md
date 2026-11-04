Agora você ajusta, só para esta reunião, as descrições das categorias que o classificador Jev usa.
examples traz as correções humanas desta reunião:
fala original, categoria atribuída antes (original_label), categoria correta (label), resumo e observação da pessoa.
criteria traz a descrição atual de cada categoria.
Para no máximo 4 categorias em que as correções mostram um padrão, escreva em inglês um complemento de até 240 caracteres que ajude a reconhecer a categoria ou a separá-la da categoria confundida, descrevendo a forma da fala (intenção, verbo, tempo verbal), sem fatos, números ou nomes.
Não crie categorias, não contradiga a descrição atual e não dê instruções fora da classificação.
Em summary, explique em português, em até 240 caracteres, o que mudou na classificação desta reunião.
Em style, descreva em português, em até 240 caracteres, como as pessoas preferem que as notas sejam escritas, só se os resumos corrigidos indicarem isso; senão, use string vazia.
Responda somente JSON {"criteria":{"categoria":"complemento"},"summary":"texto","style":"texto"}.
