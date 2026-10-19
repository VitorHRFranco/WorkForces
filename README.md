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

### No escritório

- Ande com as setas ou WASD. Cada pessoa recebe uma mesa na primeira vez que aparece (pelo navegador ou pela ponte): a primeira livre, na ordem do mapa.
- Os agentes de cada pessoa aparecem como robôs na mesa dela, com o rótulo e o status. Robô esmaecido: o dono está fora ou a ponte está reconectando.
- Chegue perto de uma mesa com agentes para ver o terminal ao vivo, só leitura, com uma aba por agente. Ao se afastar, o painel fecha.
- Enter abre o chat; Enter manda; Esc volta ao mapa. O chat guarda só as últimas 200 mensagens, em memória: reiniciar o servidor apaga.

### Editar o mapa

O mapa é um arquivo do [Tiled](https://www.mapeditor.org/) (`assets/map/office.tmj`). Para o escritório entender o mapa:

- um único tileset, **embutido** no mapa, com a imagem na mesma pasta do `.tmj`;
- camadas de tiles com a propriedade booleana `collides` = `true` bloqueiam a passagem (paredes, móveis);
- um objeto do tipo `spawn` (ponto) marca a entrada;
- cada mesa é um retângulo do tipo `desk` (a zona onde quem chega vê o terminal), com um nome único em minúsculas (`mesa-1`, `mesa-2`…); a ordem das mesas no mapa é a ordem em que elas são distribuídas;
- até 3 pontos do tipo `robot` por mesa, com a propriedade `desk` = nome da mesa, marcam onde aparecem os robôs.

Se algo não bater, o servidor não sobe e diz o motivo. Para usar outro mapa, aponte `WF_MAP` para ele.

A arte é o [1-Bit Pack](https://kenney.nl/assets/1-bit-pack), do Kenney, em domínio público (CC0); veja `assets/CREDITS.md`.

Configuração por variáveis de ambiente:

| Variável | Padrão | Uso |
|---|---|---|
| `WF_PORT` | `4600` | porta do servidor |
| `WF_HOST` | `127.0.0.1` | interface em que escuta (`0.0.0.0` para a rede; defina também `WF_PUBLIC_URL` com o endereço que as pessoas abrem) |
| `WF_PUBLIC_URL` | `http://localhost:<porta>` | endereço que o navegador usa (links de convite e origem aceita) |
| `WF_DATA_DIR` | `~/.workforces-server` | onde fica o banco SQLite |
| `WF_CLIENT_DIR` | `packages/client/dist` | build do cliente web |
| `WF_MAP` | `assets/map/office.tmj` | mapa do escritório (Tiled); a imagem do tileset fica na mesma pasta |
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

O escritório mostra os comandos como `workforces …`; sem instalar a ponte, use `node packages/bridge/dist/cli.js` no lugar de `workforces`.

### Cliente web com recarga automática

Rode o servidor com `WF_PUBLIC_URL=http://localhost:5173` e, em outro terminal, `pnpm --filter @workforces/client dev`; abra `http://localhost:5173`.

Bash:

```bash
WF_PUBLIC_URL=http://localhost:5173 node packages/server/dist/cli.js start
```

PowerShell:

```powershell
$env:WF_PUBLIC_URL = "http://localhost:5173"; node packages/server/dist/cli.js start
```
