# Aurora CanSat — telemetria Arduino

Este é um repositório local demonstrativo conectado à Memória do Projeto.

- Código: [aurora-cansat-arduino.ino](./aurora-cansat-arduino.ino)
- Fonte de desenvolvimento: `examples/aurora-cansat-arduino/`
- Alvo: Arduino Uno
- Saída: telemetria CSV a cada segundo

O exemplo lê um TMP36 em `A0`, monitora uma bateria por divisor resistivo em `A1` e transmite contador, tempo, temperatura, tensão e checksum pela serial a `115200 baud`.

Antes de usar em hardware real, confirme a referência do ADC, os resistores do divisor e os limites elétricos da placa.
