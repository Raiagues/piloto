# Norte

Reuniões com simulação de vigas: transcrição ao vivo, canvas de assuntos, simulação e ata.

- **Conta comum**: só a Simulação de vigas.
- **Conta admin**: todas as bancadas de teste (Ao vivo, Manual, Automatizados, Memória, Reuniões).

**Publicar no Render**: veja [DEPLOY.md](DEPLOY.md). Atalho: <https://render.com/deploy?repo=https://github.com/Raiagues/piloto>

## Rodar localmente

```bash
cp .env.example .env   # preencha as chaves e ADMIN_PASSWORD
./start                # http://127.0.0.1:8000
./stop
```

Localmente o banco é SQLite em `.runtime/`; no Render é Postgres (`DATABASE_URL`). Nenhuma chave fica no repositório.

## Testes

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
for f in tests/*.test.cjs; do node "$f"; done
node tests/browser-accounts.cjs   # servidor real + Chrome headless
```

`TEST_DATABASE_URL=postgresql://…` roda os testes de contas também contra um Postgres.
