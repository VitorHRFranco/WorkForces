# WorkForces

Escritório virtual 2D para times que trabalham com agentes de código (Claude Code). Cada agente roda na máquina de quem o chamou; quem chega perto da mesa vê o terminal do agente ao vivo, só para leitura.

> Em construção.

## Desenvolvimento

Requisitos: Node 22.12 ou mais novo e pnpm 12 (`npm install -g pnpm@12.11.2`).

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

## Rodar o escritório localmente

```bash
pnpm build
node packages/server/dist/cli.js start
```

O escritório abre em `http://localhost:4600`. Na primeira execução, o console mostra um link de convite de admin (válido por 24 h): abra-o no navegador para criar a primeira conta.

Configuração por variáveis de ambiente:

| Variável | Padrão | Uso |
|---|---|---|
| `WF_PORT` | `4600` | porta do servidor |
| `WF_HOST` | `127.0.0.1` | interface em que escuta (`0.0.0.0` para a rede) |
| `WF_PUBLIC_URL` | `http://localhost:<porta>` | endereço que o navegador usa (links de convite e origem aceita) |
| `WF_DATA_DIR` | `~/.workforces-server` | onde fica o banco SQLite |
| `WF_CLIENT_DIR` | `packages/client/dist` | build do cliente web |
| `WF_INSECURE` | desligado (`1` liga) | permite `WF_PUBLIC_URL` com HTTP fora de localhost |
| `WF_TRUST_PROXY` | desligado (`1` liga) | confia em `X-Forwarded-For` (atrás de um proxy reverso) |

Para desativar uma conta: `node packages/server/dist/cli.js user disable <nome>`.

Rode com as mesmas variáveis `WF_*` do servidor: o comando abre o banco em `WF_DATA_DIR` e valida `WF_PUBLIC_URL`.

### Conectar a ponte

No escritório, abra "Tokens da ponte", crie um token e rode na sua máquina:

```bash
node packages/bridge/dist/cli.js login http://localhost:4600
node packages/bridge/dist/cli.js claude
```

### Cliente web com recarga automática

Rode o servidor com `WF_PUBLIC_URL=http://localhost:5173` e, em outro terminal, `pnpm --filter @workforces/client dev`; abra `http://localhost:5173`.
