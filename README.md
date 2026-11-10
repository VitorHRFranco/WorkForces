# WorkForces

Escritório virtual 2D para times que trabalham com agentes de código (Claude Code). Cada pessoa entra pelo app de desktop (Windows). Cada agente roda na máquina de quem o chamou; quem chega perto da mesa vê o terminal do agente ao vivo, só para leitura.

![Demonstração: o avatar anda até a mesa de outra pessoa e vê o terminal do agente dela ao vivo, com o token mascarado, e as duas conversam no chat](docs/media/demo.gif)

> Em construção.

## Desenvolvimento

Requisitos: Node 22.12 ou mais novo e pnpm 12 (`npm install -g pnpm@12.11.2`).

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

`pnpm e2e` sobe o servidor, a ponte e o app (Electron) do build, e `pnpm demo` grava o GIF deste README. Os dois pesam na CPU e rodam na esteira do GitHub: o E2E no CI, e o GIF no workflow manual "GIF do README". No Linux sem tela, rode com `xvfb-run -a`.

## Rodar o escritório localmente

```bash
pnpm build
node packages/server/dist/cli.js start
```

Em outro terminal, abra o app com `pnpm app`. Na primeira execução, o console do servidor mostra um link de convite de admin (válido por 24 h). No app, cole o link em "Entrar com convite" e crie a primeira conta. O escritório fica salvo, e nas próximas vezes o app já abre nele.

O app é o único jeito de entrar. O servidor não serve mais páginas para o navegador, só a API, o mapa e a página do link de convite, que abre o app.

### No escritório

- Ande com as setas ou WASD. Pare perto de uma cadeira (ou do sofá) para sentar; qualquer tecla de movimento (setas ou WASD) levanta. Cada pessoa recebe uma mesa na primeira vez que aparece (pelo app): a primeira livre, na ordem do mapa.
- Os agentes de cada pessoa aparecem como robôs na mesa dela, com o rótulo e o status. Robô esmaecido: o dono está fora ou a ponte está reconectando.
- Chegue perto de uma mesa com agentes para ver o terminal ao vivo, só leitura, com uma aba por agente. Com o painel aberto, a câmera desloca o mapa para você continuar à vista; ao se afastar, o painel fecha. Para ver os seus, use "Meus agentes" (veja [Agentes](#agentes)).
- Enter abre o chat; Enter manda; Esc volta ao mapa. O chat guarda só as últimas 200 mensagens, em memória: reiniciar o servidor apaga.
- **Mesa: aberta/fechada**, na barra de cima: com a mesa fechada, ninguém vê o terminal dos seus agentes (nem você, pelo mapa). Os robôs continuam na mesa, com a placa "fechada", e a escolha vale até você abrir de novo, mesmo que o servidor reinicie.

### Editar o mapa

O mapa é um arquivo do [Tiled](https://www.mapeditor.org/) (`assets/map/office.tmj`), com tiles de 32 px. Para o escritório entender o mapa:

- um único tileset, **embutido** no mapa, com a imagem na mesma pasta do `.tmj`;
- camadas de tiles com a propriedade booleana `collides` = `true` bloqueiam a passagem (paredes);
- as posições são as dos pés: o ponto no meio da base de quem (ou do que) está ali;
- um objeto do tipo `spawn` (ponto) marca a entrada;
- cada mesa é um retângulo do tipo `desk` (a zona onde quem chega vê o terminal), com um nome único em minúsculas (`mesa-1`, `mesa-2`…); a ordem das mesas no mapa é a ordem em que elas são distribuídas;
- até 3 pontos do tipo `robot` por mesa, com a propriedade `desk` = nome da mesa, marcam onde aparecem os robôs;
- pontos do tipo `seat`, com a propriedade `dir` (`up`, `down`, `left` ou `right`, para onde a pessoa olha), são assentos: quem para perto senta (a posição do assento é arredondada para pixels inteiros);
- pontos do tipo `prop`, com a propriedade `sprite`, desenham um móvel ou uma decoração com a base nesse ponto. Os nomes disponíveis estão em `packages/client/src/game/props.json`; os móveis bloqueiam a passagem pela base.

Se algo não bater, o servidor não sobe e diz o motivo. Um `sprite` que não existe no atlas só some do mapa, com um aviso no console das DevTools do app (F12, em desenvolvimento). Para usar outro mapa, aponte `WF_MAP` para ele.

**Arte.** A arte é do [LPC Revised](https://github.com/ElizaWy/LPC), sob a licença OGA-BY 3.0, com os créditos de cada peça em `assets/CREDITS.md`; o robô é desenho próprio. As imagens são geradas por `tools/art/build_art.py` (Python 3.10+ e [Pillow](https://pypi.org/project/pillow/)), que baixa as peças do LPC Revised de um commit fixado:

```bash
python tools/art/build_art.py          # refaz as imagens e o props.json
python tools/art/build_art.py --map    # também refaz o mapa (descarta edições feitas no Tiled)
```

Configuração por variáveis de ambiente:

| Variável | Padrão | Uso |
|---|---|---|
| `WF_PORT` | `4600` | porta do servidor |
| `WF_HOST` | `127.0.0.1` | interface em que escuta (`0.0.0.0` para a rede; defina também `WF_PUBLIC_URL` com o endereço que as pessoas abrem) |
| `WF_PUBLIC_URL` | `http://localhost:<porta>` | endereço público do escritório: vai nos links de convite e é a única origem aceita |
| `WF_DATA_DIR` | `~/.workforces-server` | onde fica o banco SQLite |
| `WF_MAP` | `assets/map/office.tmj` | mapa do escritório (Tiled, tiles de 32 px); a imagem do tileset fica na mesma pasta |
| `WF_INSECURE` | desligado (`1` liga) | permite `WF_PUBLIC_URL` com HTTP fora de localhost; o app só aceita HTTP em localhost, então quem está em outro computador não entra num servidor sem HTTPS |
| `WF_TRUST_PROXY` | desligado (`1` liga) | confia em `X-Forwarded-For` (atrás de um proxy reverso) |

Para desativar uma conta: `node packages/server/dist/cli.js user disable <nome>`.

Rode com as mesmas variáveis `WF_*` do servidor: o comando abre o banco em `WF_DATA_DIR` e valida `WF_PUBLIC_URL`.

### Agentes

Os agentes rodam no seu computador, e quem os abre é o app (por enquanto, só no Windows). O escritório não abre agentes nem conhece as suas pastas: ele vê só o robô e a tela já mascarada.

- **Pastas:** em "Chamar agente" → "Pastas…", libere as pastas de projeto que o app pode abrir, escolhendo cada uma pelo seletor do Windows. "Chamar agente" mostra as IAs (só o Claude funciona por enquanto; as outras aparecem como "em breve") e as pastas liberadas. O agente abre na pasta escolhida, e o robô aparece na sua mesa.
- **Requisitos:** cada agente abre numa janela do Windows Terminal, que o app minimiza logo em seguida. É preciso ter o Claude Code (o comando `claude` no PATH), o Node.js 22.12 ou mais novo (o do `PATH`, ou o `node.exe` indicado em `WF_NODE`) e o Windows Terminal, que já vem no Windows 11; no Windows 10, instale com `winget install Microsoft.WindowsTerminal`.
- **Limites:** no máximo um pedido a cada 5 s e 5 agentes abertos neste computador.
- **Meus agentes:** o botão na barra de cima mostra o terminal dos agentes que este app abriu, só para a conta que está aberta (outra conta no mesmo escritório não os vê), e deixa digitar neles. A digitação vai deste computador direto para o agente, sem passar pelo escritório; quem visita a sua mesa continua só olhando.
- **Depois de fechar:** fechar o app não fecha os agentes: eles continuam na janela deles e no mapa. Ao reabrir o app, eles voltam ao "Meus agentes", porque o app guarda os agentes que abriu no `local-agents.json`, na pasta de dados do app.
- **Máscara:** a tela do agente sai deste computador com os tokens e as senhas conhecidos mascarados. Para mascarar outros padrões, acrescente expressões regulares à lista `secretPatterns` do `agents.json`, na pasta de dados do app (`%APPDATA%\@workforces\app` com `pnpm app`, ou a pasta de `WF_APP_DATA_DIR`). Saia do app pelo ícone da bandeja (Sair) antes de editar: fechar a janela só esconde o app, e liberar ou remover uma pasta regrava o `agents.json`. Os padrões valem para os agentes chamados depois que ele abrir de novo.
- **Acessos:** cada computador entra no escritório com um acesso próprio, que o app cria sozinho. "Computadores", na barra de cima, lista os acessos de cada computador e permite revogar; depois de revogar, o app cria outro na próxima vez que você chamar um agente.
- **Quem usava a ponte pela linha de comando:** o `~/.workforces/config.json` antigo (`%USERPROFILE%\.workforces\config.json`) ainda guarda o token antigo em texto puro. Apague o arquivo e revogue esse token em "Computadores".

### Criar escritório (neste computador)

O app pode hospedar o escritório no seu próprio computador, sem Docker. Na tela inicial, em "Neste computador", clique em "Criar escritório", escolha o modo e a porta (o padrão é 4600; vale de 1024 a 65535) e clique em "Criar e entrar". Você cria a primeira conta, que é a de admin, e entra.

Abrir o app não liga o escritório: use "Ligar e entrar". Ele fica no ar enquanto o app roda, mesmo com a janela fechada (ela só se esconde na bandeja). "Sair", no ícone da bandeja, desliga o escritório, e ele também cai se o computador desligar; para um escritório sempre ligado, use o servidor da seção abaixo. Para trocar o modo, a porta ou o endereço, use "Configurar": o escritório reinicia em alguns segundos. Quem está dentro reconecta sozinho se a porta e o IP deste computador continuarem os mesmos; senão, usa "Trocar endereço" (abaixo).

- **Hospedar LAN (o padrão):** entra quem está na mesma rede, ou numa VPN que põe todos numa rede virtual, como Hamachi, Radmin, ZeroTier ou Tailscale. Em "Endereço no convite", escolha a rede que vai no convite: o app sugere o Wi-Fi ou a Ethernet e mostra as VPNs com o nome delas. Não é preciso mexer no roteador.
- **Hospedar WAN (internet):** entra também quem está fora, pelo seu IP público, na porta escolhida.
  - O app pede ao roteador, por UPnP, que abra a porta, e a fecha ao desligar. Funciona com a maioria dos roteadores com o UPnP ligado.
  - Quando o roteador não abre a porta, a tela mostra o passo a passo para abrir à mão, já com o IP deste computador e a porta: reservar esse IP no DHCP do roteador, redirecionar a porta (TCP) para ele e liberar o Node.js no firewall.
  - O convite leva o IP público que o roteador informa, ou o IP ou nome (DDNS) que você digitar em "Endereço da internet". Sem nenhum dos dois, ele leva o endereço da rede local, e a tela pede o IP público ou o nome.
  - **CGNAT:** se o IP que o roteador informa não for público (o provedor usa CGNAT, ou há dois roteadores em sequência), quem está fora não chega por ele, e a tela avisa. Peça um IP público ao provedor ou hospede em LAN com uma VPN.
  - O app não consulta serviço de fora para descobrir o IP nem para testar a porta.
- **Firewall:** ao ligar pela primeira vez, o Windows pergunta se libera o "Node.js" (o programa que roda o escritório) na rede. Marque redes privadas e também públicas: o Windows trata o Hamachi e outras VPNs como rede pública. Se negou sem querer: Painel de Controle → Firewall do Windows Defender → Permitir um aplicativo → Node.js → marque Privada e Pública.
- **Convite:** "Gerar convite", na barra de cima do escritório, dá um link `workforces://invite?…` com o pino do certificado do escritório. A pessoa clica no link ou, se o chat não o deixar clicável, cola em "Entrar com convite" no app; no navegador ele não abre. O app confere o pino sozinho: ninguém instala certificado nem vê aviso de segurança.
- **Trocar endereço:** o endereço muda quando muda o IP deste computador ou o público, ou quando você troca o modo ou a porta; a tela do anfitrião avisa quando o IP muda. Quem já entrou usa "Trocar endereço" no escritório salvo, na tela inicial do app, com o endereço novo. A conta e o pino continuam valendo, e o pino garante que é o mesmo escritório.
- **Node.js:** por enquanto, o escritório roda no Node.js do computador, e é preciso ter o 22.12 ou mais novo (o mesmo dos agentes: o do `PATH`, ou o `node.exe` indicado em `WF_NODE`).
- **Dados:** o banco e o certificado ficam na pasta `office`, dentro da pasta de dados do app. Apagar essa pasta gera outro certificado, e quem já entrou precisa de um convite novo.

### Servidor para um time (Docker + Caddy)

Para outras pessoas entrarem de outros computadores, o servidor precisa ficar numa máquina que todos alcancem, com HTTPS: fora de localhost, servidor e ponte recusam HTTP sem TLS, e o servidor avisa no log quando escuta na rede sem HTTPS. A pasta `deploy/` tem um exemplo com o [Caddy](https://caddyserver.com/) na frente, que gera e renova o certificado sozinho.

Numa máquina com Docker, as portas 80 e 443 livres e um nome no DNS apontando para ela:

```bash
cd deploy
WF_DOMAIN=escritorio.exemplo.com.br docker compose up -d --build
docker compose logs workforces   # o primeiro convite de admin aparece aqui
```

- As contas ficam no volume `workforces-data`. Para atualizar: `git pull` e o mesmo `docker compose up -d --build`; depois, quem estiver no escritório clica em "Escritórios" e entra de novo.
- Na primeira subida, o Caddy espera o servidor ficar saudável (uns 30 s) antes de responder.
- Use um domínio (ou subdomínio) só para o escritório: um site num domínio pai pode criar cookies que atrapalham o de sessão.
- Não publique a porta 4600 do servidor: só o Caddy fala com ele.
- Para usar no trabalho: só com aprovação de TI/segurança e num servidor interno.

**Rede interna, sem DNS público.** Suba junto com a variante `deploy/docker-compose.internal.yml`, que usa o certificado interno do Caddy (`tls internal`):

```bash
WF_DOMAIN=escritorio.interno docker compose -f docker-compose.yml -f docker-compose.internal.yml up -d --build
```

Ninguém precisa instalar a CA: os convites levam o pino dela, e o app e os agentes conferem sozinhos. Uma CA que já foi instalada no Windows continua valendo.

Para testar só a imagem, sem o Caddy:

```bash
docker build -t workforces .
docker run -p 127.0.0.1:4600:4600 -e WF_PUBLIC_URL=http://localhost:4600 workforces
```

O log avisa que está sem HTTPS (dentro do container o servidor escuta na rede); publicar a porta só em `127.0.0.1` deixa o acesso restrito a este computador.

### O app em desenvolvimento

`pnpm app` abre o app a partir do build (`packages/app/dist` e `packages/client/dist`). Depois de mudar o cliente, rode `pnpm --filter @workforces/client build` (ou deixe `pnpm --filter @workforces/client dev` rodando) e aperte F5 na janela do app; F12 abre as DevTools. Ao abrir, o app registra o link `workforces://` neste Windows para esta cópia; é assim que o link de convite do navegador chega a ele.
