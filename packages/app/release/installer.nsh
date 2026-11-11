; Ganchos do instalador NSIS do electron-builder (nsis.include no electron-builder.json).

; O link workforces:// abre o app instalado. O "protocols" do electron-builder só vale no macOS: no Windows, o registro é
; aqui, igual ao que o app grava ao abrir (app.setAsDefaultProtocolClient), para o link já funcionar antes da primeira vez.
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\workforces" "" "URL:workforces"
  WriteRegStr SHCTX "Software\Classes\workforces" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\workforces\shell\open\command" "" '"$appExe" "%1"'
!macroend

; O app copia o runtime (Node, servidor e ponte) para fora da pasta de instalação. Numa atualização, o desinstalador da
; versão antiga também roda: aí o runtime e o link ficam (o Node é o mesmo entre versões, e a regra do firewall vale por
; ele). Só a desinstalação de verdade apaga os dois. A pasta de dados (%APPDATA%\@workforces\app) fica sempre.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey SHCTX "Software\Classes\workforces"
    RMDir /r "$LOCALAPPDATA\WorkForces\runtime"
    ; Só sai se ficou vazia.
    RMDir "$LOCALAPPDATA\WorkForces"
  ${endIf}
!macroend
