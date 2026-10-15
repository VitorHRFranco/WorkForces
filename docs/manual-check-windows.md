# Checagem manual no Windows — invólucro `escritorio claude`

Use um projeto de brinquedo, nunca um projeto da empresa.

## Preparação

```powershell
cd C:\ProjLocais\WorkForces\WorkForces
pnpm install
pnpm build
# atalho para esta sessão do PowerShell
function escritorio { node C:\ProjLocais\WorkForces\WorkForces\packages\bridge\dist\cli.js @args }
```

## 1. Sem login (só o caminho rápido)

Num projeto de brinquedo, no Windows Terminal e depois no terminal integrado do VS Code:

1. `escritorio claude`: aparece `escritorio: sem login no escritório; rodando sem espelhar` e o Claude abre normalmente.
2. Digite um prompt curto, use as setas, `Esc`, `Ctrl+C` (uma vez para interromper) e redimensione a janela: tudo igual ao `claude` puro.
3. Saia com `/exit`. Rode `echo $LASTEXITCODE`: deve ser o mesmo código que o `claude` puro devolve.
4. `escritorio claude -p "diga oi" | Out-String`: a saída vem limpa, sem sequências de escape.

## 2. Com o visualizador de desenvolvimento

1. Terminal A (maior que o B): `node packages/bridge/scripts/dev-viewer.mjs`
2. Terminal B:

   ```powershell
   $env:WORKFORCES_HOME = "$env:TEMP\wf-dev"
   New-Item -ItemType Directory -Force $env:WORKFORCES_HOME | Out-Null
   '{ "server": "http://localhost:4599", "token": "dev" }' | Set-Content -Encoding utf8 "$env:WORKFORCES_HOME\config.json"
   escritorio claude
   ```

3. O terminal A mostra `ponte conectada` e depois a tela do Claude, acompanhando o que acontece no B.
4. No Claude (terminal B), rode um comando de shell com `!` que imprima um token falso, por exemplo `! node -e "console.log('ghp_' + 'a'.repeat(36))"`. No terminal A, o token aparece como `••••…`.
5. Redimensione o terminal B: o A se redesenha inteiro com o novo tamanho.
6. Feche o terminal A no meio da sessão: o Claude no B continua igual, sem nenhuma mensagem. Abra o A de novo: em até ~30 s a ponte reconecta e a tela volta.
7. Saia do Claude e confira `$env:WORKFORCES_HOME\bridge.log`: há as linhas de reconexão e nenhum conteúdo da tela.

Anote no PR o que passou, o que falhou e em qual terminal.
