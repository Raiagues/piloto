# Aurora CanSat — telemetria Arduino

Repositório demonstrativo mínimo para testar uma fonte de código conectada à Memória do Projeto.

## Hardware de bancada

- Arduino Uno ou compatível
- TMP36 no pino `A0`
- divisor resistivo da bateria no pino `A1`
- monitor serial a `115200 baud`

Confirme a tensão máxima no pino analógico antes de energizar o circuito. O divisor configurado no código pressupõe `R1 = 10 kΩ` e `R2 = 10 kΩ`; ajuste os valores para o hardware real.

## Executar

Com Arduino CLI instalado:

```bash
arduino-cli compile --fqbn arduino:avr:uno .
arduino-cli upload -p /dev/ttyACM0 --fqbn arduino:avr:uno .
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
```

Cada linha produz um quadro CSV:

```text
sequence,milliseconds,temperature_c,battery_v,checksum
```

O checksum é uma verificação simples de transporte para o protótipo; não é um mecanismo criptográfico.
