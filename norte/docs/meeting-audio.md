# Áudio das reuniões

A pessoa entra no áudio por um botão e autoriza o próprio microfone. O navegador transmite áudio por WebRTC para os demais participantes autorizados da reunião. A sinalização usa a sessão e a proteção CSRF do Norte; SDP e candidatos de rede ficam somente na memória do processo, por até dois minutos. O áudio não é gravado no servidor.

O limite desta implementação é de **12 pessoas simultâneas no áudio**, com conexões diretas entre pares. Mais pessoas podem acompanhar e escrever na transcrição. Para grupos maiores, a arquitetura deve migrar para um SFU; aumentar apenas esse número não é suficiente.

## Configuração do servidor

O site precisa ser servido por HTTPS. Para testes locais, o navegador aceita localhost. Sem configuração adicional, STUN público permite conexão em redes compatíveis. **Para funcionamento entre redes restritivas, configure um servidor TURN alcançável externamente.** A aplicação não instala esse servidor nem compra créditos automaticamente.

Variáveis do serviço Node do Norte:

```dotenv
NORTE_TURN_URLS=turn:turn.exemplo.com:3478,turns:turn.exemplo.com:443?transport=tcp
NORTE_TURN_SECRET=SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES
# Opcional; substitui o STUN padrão.
NORTE_STUN_URLS=stun:stun.exemplo.com:3478
```

O hostname acima é um exemplo: substitua pelo endereço de um TURN real. Em coturn, configure `use-auth-secret`, `static-auth-secret` com o mesmo segredo, um `realm`, certificado TLS válido e as portas de escuta e retransmissão autorizadas no firewall. Não publique o segredo em repositório ou em variáveis VITE. O backend emite credenciais HMAC temporárias vinculadas ao usuário, válidas por uma hora; o navegador as renova a cada 30 minutos. Também é possível usar um fornecedor TURN que aceite esse protocolo de credenciais; um serviço que só forneça credenciais estáticas não usa diretamente estas variáveis.

A sinalização em memória exige **uma instância Node** ou roteamento consistente de todos os participantes de uma reunião para a mesma instância. Reiniciar o processo desconecta o áudio, sem apagar a transcrição e a reunião persistidas. As pessoas podem entrar novamente.

## Controles e transcrição

- Silenciar o próprio microfone desabilita as trilhas locais imediatamente.
- O anfitrião pode silenciar outra pessoa. A moderação também silencia a reprodução nos demais navegadores e impede o envio de falas para transcrição.
- Liberar a pessoa não ativa seu microfone: ela precisa tocar em “Ativar microfone”.
- O anfitrião mantém a captura da reunião. Participantes com navegador compatível enviam as falas finais reconhecidas somente enquanto o anfitrião mantém a gravação ativa. Iniciar por mensagem não inicia gravação; pausar a gravação interrompe também o reconhecimento remoto. A autorização de captura expira após 20 segundos sem renovação pelo anfitrião. Esse reconhecimento depende do serviço de voz do navegador, distinto do transporte WebRTC; caso indisponível, a mensagem escrita continua disponível.
- A pessoa convidada não precisa executar classificação ou gerar seu próprio resumo; o anfitrião processa a fila compartilhada uma vez.

## Validação

`node --test server/meetings.test.mjs` verifica autorização atual por equipe/setor, convites, CSRF, isolamento de sessões de áudio, moderação, consentimento para reativar, credenciais TURN e persistência do título. `node scripts/visual-meetings.mjs` usa duas contas e microfones sintéticos no Chromium para verificar conexões e pacotes RTP bidirecionais, silenciamento próprio/pelo anfitrião e o fluxo de mensagens no iframe. Os testes locais não validam o TURN de produção nem redes móveis/empresariais externas.

Referências oficiais: [WebRTC: TURN](https://webrtc.org/getting-started/turn-server), [coturn: configuração](https://github.com/coturn/coturn/wiki/turnserver), [MDN: sinalização WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling).
