; Ganchos do instalador NSIS do electron-builder (nsis.include no electron-builder.json).
; Salvo em UTF-8 com BOM: é assim que o NSIS lê os textos com acento.

!include "nsDialogs.nsh"
; O StdUtils.nsh o electron-builder já inclui antes deste arquivo. O customCheckAppRunning abaixo substitui o do electron-builder, que então deixa de trazer estes dois.
!include "getProcessInfo.nsh"
Var pid

; Usadas pelo wfDropStaleUserLink, no instalador e no desinstalador (sem mexer nos $0 a $3 do electron-builder).
Var wfLink
Var wfExe
Var wfPos
Var wfChar

!ifndef BUILD_UNINSTALLER
  ; "1" cria o atalho na área de trabalho. Em silêncio a página não aparece e vale o padrão (vazio = criar).
  Var wfDesktop
  Var wfDesktopBox
!endif

; Página "Atalhos", depois da escolha da pasta. O Menu Iniciar não é opcional; só a área de trabalho.
!macro customPageAfterChangeDir
  Page custom wfShortcutsPage wfShortcutsLeave

  Function wfShortcutsPage
    ${if} ${isUpdated}
      Abort
    ${endIf}
    !insertmacro MUI_HEADER_TEXT "Atalhos" "Onde abrir o WorkForces além do Menu Iniciar."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 0 100% 12u "Criar atalho na área de trabalho"
    Pop $wfDesktopBox
    ${if} $wfDesktop != "0"
      ${NSD_Check} $wfDesktopBox
    ${endIf}
    nsDialogs::Show
  FunctionEnd

  Function wfShortcutsLeave
    ${NSD_GetState} $wfDesktopBox $0
    ${if} $0 == ${BST_CHECKED}
      StrCpy $wfDesktop "1"
    ${else}
      StrCpy $wfDesktop "0"
    ${endIf}
  FunctionEnd
!macroend

; Apaga o link workforces:// em HKCU quando ele aponta para esta instalação ou para um exe que não existe mais. Um link
; para outra instalação que ainda existe fica. O comando é '"<exe>" "%1"': o exe é o que está entre as primeiras aspas.
!macro wfDropStaleUserLink
  ReadRegStr $wfLink HKCU "Software\Classes\workforces\shell\open\command" ""
  ${if} $wfLink != ""
    StrCpy $wfExe ""
    StrCpy $wfPos 1
    ${Do}
      StrCpy $wfChar $wfLink 1 $wfPos
      ${IfThen} $wfChar == '"' ${|} ${ExitDo} ${|}
      ${IfThen} $wfChar == "" ${|} ${ExitDo} ${|}
      StrCpy $wfExe "$wfExe$wfChar"
      IntOp $wfPos $wfPos + 1
    ${Loop}
    ${if} $wfExe == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${OrIfNot} ${FileExists} "$wfExe"
      DeleteRegKey HKCU "Software\Classes\workforces"
    ${endIf}
  ${endIf}
!macroend

; Antes de fechar à força, pede ao app aberto que saia pelo caminho normal (desliga o escritório deste computador e solta
; os canais dos agentes): `WorkForces.exe --quit` chega à instância aberta pelo second-instance. Roda como o usuário, não
; como administrador, para achar a instância dele. Depois, segue o que o electron-builder faz (perguntar e encerrar).
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${ifNot} ${isUpdated}
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
    ${andIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      DetailPrint "Pedindo ao WorkForces aberto que saia"
      ${StdUtils.ExecShellAsUser} $R1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" "--quit"
      StrCpy $R1 0
      ${Do}
        Sleep 500
        IntOp $R1 $R1 + 1
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${IfThen} $R0 != 0 ${|} ${ExitDo} ${|}
      ${LoopUntil} $R1 >= 30
    ${endIf}
  ${endIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend

; $DESKTOP e $SMPROGRAMS seguem o modo escolhido: do usuário ("só para mim") ou de todos ("para todos os usuários").
!macro customInstall
  ; O link workforces:// abre o app instalado. O "protocols" do electron-builder só vale no macOS: no Windows, o registro
  ; é aqui, igual ao que o app grava ao abrir (app.setAsDefaultProtocolClient), para o link já funcionar antes da primeira vez.
  WriteRegStr SHCTX "Software\Classes\workforces" "" "URL:workforces"
  WriteRegStr SHCTX "Software\Classes\workforces" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\workforces\shell\open\command" "" '"$appExe" "%1"'

  ; Trocar de "só para mim" para "para todos": o electron-builder roda o desinstalador da instalação por usuário como
  ; atualização (--updated), e aí ele não apaga os atalhos dela. Sem isto, ficam quebrados e repetidos ao lado dos novos.
  ${if} $installMode == "all"
    SetShellVarContext current
    WinShell::UninstShortcut "$DESKTOP\WorkForces.lnk"
    Delete "$DESKTOP\WorkForces.lnk"
    WinShell::UninstShortcut "$SMPROGRAMS\WorkForces\WorkForces.lnk"
    Delete "$SMPROGRAMS\WorkForces\WorkForces.lnk"
    Delete "$SMPROGRAMS\WorkForces\Desinstalar WorkForces.lnk"
    RMDir "$SMPROGRAMS\WorkForces"
    SetShellVarContext all
    ; O link em HKCU da instalação por usuário também fica para trás, apontando para o exe que ela já apagou.
    !insertmacro wfDropStaleUserLink
  ${endIf}

  ; Numa atualização, o atalho da área de trabalho fica como a pessoa deixou (inclusive apagado); os do Menu Iniciar
  ; são refeitos, apontando para o mesmo lugar.
  ${ifNot} ${isUpdated}
    ${if} $wfDesktop != "0"
      CreateShortCut "$DESKTOP\WorkForces.lnk" "$appExe"
      ClearErrors
      WinShell::SetLnkAUMI "$DESKTOP\WorkForces.lnk" "${APP_ID}"
    ${else}
      ; Reinstalar com a caixa desmarcada tira o atalho que já existia.
      WinShell::UninstShortcut "$DESKTOP\WorkForces.lnk"
      Delete "$DESKTOP\WorkForces.lnk"
    ${endIf}
  ${endIf}

  ; A pasta WorkForces do Menu Iniciar é feita aqui, e não pelo "menuCategory" do electron-builder: ele põe esse nome
  ; também no caminho da instalação para todos (C:\Program Files\WorkForces\WorkForces). O AUMI liga o atalho às
  ; notificações e à barra de tarefas do app, como o electron-builder faz nos atalhos dele.
  CreateDirectory "$SMPROGRAMS\WorkForces"
  CreateShortCut "$SMPROGRAMS\WorkForces\WorkForces.lnk" "$appExe"
  ClearErrors
  WinShell::SetLnkAUMI "$SMPROGRAMS\WorkForces\WorkForces.lnk" "${APP_ID}"
  CreateShortCut "$SMPROGRAMS\WorkForces\Desinstalar WorkForces.lnk" "$INSTDIR\Uninstall WorkForces.exe"
  ClearErrors
!macroend

; O app copia o runtime (Node, servidor e ponte) para fora da pasta de instalação. Numa atualização, o desinstalador da
; versão antiga também roda: aí o runtime, os atalhos, o link e os dados ficam (o Node é o mesmo entre versões, e a regra
; do firewall vale por ele). Só a desinstalação de verdade apaga; os dados, só se a pessoa disser Sim.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey SHCTX "Software\Classes\workforces"
    WinShell::UninstShortcut "$DESKTOP\WorkForces.lnk"
    Delete "$DESKTOP\WorkForces.lnk"
    WinShell::UninstShortcut "$SMPROGRAMS\WorkForces\WorkForces.lnk"
    Delete "$SMPROGRAMS\WorkForces\WorkForces.lnk"
    Delete "$SMPROGRAMS\WorkForces\Desinstalar WorkForces.lnk"
    ; Só sai se ficou vazia.
    RMDir "$SMPROGRAMS\WorkForces"

    ; Runtime e dados são de cada pessoa: na instalação para todos, o contexto é "all" e $LOCALAPPDATA apontaria para o
    ; ProgramData. Olha a pasta de quem desinstala e volta ao contexto de antes.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}

    ; O app grava o link também em HKCU ao abrir (setAsDefaultProtocolClient), inclusive na instalação para todos: sem
    ; isto, ele ficaria apontando para o exe apagado.
    !insertmacro wfDropStaleUserLink

    ; Agentes abertos usam o node.exe do runtime, que então não sai. Com janela, pede para fechá-los; em silêncio, os
    ; arquivos em uso ficam. Encerrar os agentes à força perderia o trabalho do Claude.
    ${ifNot} ${Silent}
      wfAgentsOpen:
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -C "if ((Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$LOCALAPPDATA\WorkForces\runtime', 'CurrentCultureIgnoreCase')}).Count -gt 0) { exit 0 } else { exit 1 }"`
      Pop $wfChar
      ${if} $wfChar == 0
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Há agentes do WorkForces abertos. Feche as janelas deles e clique em Repetir para remover tudo, ou em Cancelar para deixar os arquivos deles para trás." IDRETRY wfAgentsOpen
      ${endIf}
    ${endIf}

    RMDir /r "$LOCALAPPDATA\WorkForces\runtime"
    ; Só sai se ficou vazia.
    RMDir "$LOCALAPPDATA\WorkForces"

    ; Em silêncio (/S) a resposta é Não: os dados ficam.
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Apagar também os seus escritórios salvos e o seu personagem?$\r$\n$\r$\nEles ficam em $APPDATA\@workforces\app. Se responder Não, eles continuam lá para uma próxima instalação." /SD IDNO IDNO wfKeepData
      RMDir /r "$APPDATA\@workforces\app"
      ; Só sai se ficou vazia.
      RMDir "$APPDATA\@workforces"
    wfKeepData:

    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
  ${endIf}
!macroend
