# Checagem manual no Windows — invólucro `escritorio claude`

Use um projeto de brinquedo, nunca um projeto da empresa.

## Preparação

No PowerShell, dentro da pasta do repositório (a que tem este `docs/`):

```powershell
pnpm install
pnpm build
```

O comando `escritorio` ainda não é instalado no sistema. Para criar um atalho, rode isto **em cada janela do PowerShell** que for usar, ainda dentro da pasta do repositório:

```powershell
$repo = $PWD.Path
function escritorio { node "$repo\packages\bridge\dist\cli.js" @args }
```

Depois disso, pode entrar (`cd`) na pasta do projeto de brinquedo: o atalho continua valendo naquela janela.

## 1. Sem login (só o caminho rápido)

Num projeto de brinquedo, no Windows Terminal e depois no terminal integrado do VS Code:

1. `escritorio claude`: o Claude abre normalmente. Depois que o Claude termina, aparece de novo `escritorio: sem login no escritório; rodando sem espelhar` (ao abrir, o ConPTY limpa a tela e apaga o aviso impresso antes).
2. Digite um prompt curto, use as setas, `Esc`, `Ctrl+C` (uma vez para interromper) e redimensione a janela: tudo igual ao `claude` puro.
3. Saia com `/exit`. Rode `echo $LASTEXITCODE`: deve ser o mesmo código que o `claude` puro devolve.
4. `escritorio claude -p "diga oi" | Out-String`: a saída vem limpa, sem sequências de escape.

## 2. Com o visualizador de desenvolvimento

1. Terminal A (maior que o B), na pasta do repositório: `node packages/bridge/scripts/dev-viewer.mjs`
2. Terminal B: uma janela nova do PowerShell. Crie o atalho como na Preparação, entre no projeto de brinquedo e rode:

   ```powershell
   $env:WORKFORCES_HOME = "$env:TEMP\wf-dev"
   New-Item -ItemType Directory -Force $env:WORKFORCES_HOME | Out-Null
   '{ "server": "http://127.0.0.1:4599", "token": "dev" }' | Set-Content -Encoding utf8 "$env:WORKFORCES_HOME\config.json"
   escritorio claude
   ```

3. O terminal A mostra `ponte conectada` e depois a tela do Claude, acompanhando o que acontece no B.
4. No Claude (terminal B), rode um comando de shell com `!` que imprima um token falso, por exemplo `! node -e "console.log('ghp_' + 'a'.repeat(36))"`. No terminal A, o token aparece como `••••…`.
5. Com a janela B estreita (~40 colunas), peça ao Claude para repetir um token falso longo (ex.: `ghp_` + 36 letras `a`) numa frase. No terminal A, o token aparece mascarado mesmo quebrado em duas linhas.
6. Redimensione o terminal B: o A se redesenha inteiro com o novo tamanho.
7. Feche o terminal A no meio da sessão: o Claude no B continua igual, sem nenhuma mensagem. Abra o A de novo: em até ~30 s a ponte reconecta e a tela volta.
8. Saia do Claude e confira `$env:WORKFORCES_HOME\bridge.log`: há as linhas de reconexão e nenhum conteúdo da tela.

## 3. Teclado e colagem (sem login basta)

Rode `escritorio claude` e confira:

1. `Shift+Tab` alterna os modos do Claude: igual ao `claude` puro.
2. Colar um texto de várias linhas (colagem com bracketed paste): igual ao `claude` puro.
3. `Shift+Enter` (ou `Alt+Enter`) quebra linha no prompt: igual ao `claude` puro.
4. Acentos e teclas mortas no teclado ABNT2 (digitar `ação`, `é`, `ç`): igual ao `claude` puro.
5. `Ctrl+V` com uma imagem na área de transferência: igual ao `claude` puro.
6. Depois de sair, alternar o foco da janela para outra e voltar: não aparecem `^[[I`/`^[[O` soltos no shell, igual ao `claude` puro.

Anote no PR o que passou, o que falhou e em qual terminal.
