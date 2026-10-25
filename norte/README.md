# Norte · interface e API

Este diretório contém o frontend React/TypeScript e a API Fastify. A entrada da instalação integrada, o worker de reuniões e a documentação estão na [raiz do repositório](../README.md).

```bash
npm ci
npm run dev       # frontend/API para desenvolvimento
npm run quality  # tipos, lint, testes e build
npm run test:visual
```

Use Node.js 24.20+. Para testar também a sala de reuniões, inicie a instalação pela raiz com `./start`. A implantação integrada usa `../Dockerfile` e `../render.yaml`.

Veja [arquitetura](../docs/architecture.md), [estilos](src/styles/README.md), [privacidade](server/privacy.mjs) e [qualidade](../docs/testing.md).
