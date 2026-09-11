!ifndef BUILD_UNINSTALLER
!include nsDialogs.nsh

Var CustomOptionsDialog
Var CheckboxDesktopShortcut
Var DesktopShortcutCheckboxState

# 1036 = French
LangString CUSTOM_OPTIONS_TITLE 1036 "Options d'installation"
LangString CUSTOM_OPTIONS_SUBTITLE 1036 "Selectionnez les raccourcis a creer pour DesktopServer :"
LangString CUSTOM_CHECKBOX_DESKTOP 1036 "Creer un raccourci sur le Bureau"
LangString CUSTOM_LABEL_STARTMENU 1036 "L'application sera installee dans votre profil utilisateur et accessible depuis le menu Demarrer de Windows."

# 1033 = English
LangString CUSTOM_OPTIONS_TITLE 1033 "Installation Options"
LangString CUSTOM_OPTIONS_SUBTITLE 1033 "Select the shortcuts to create for DesktopServer:"
LangString CUSTOM_CHECKBOX_DESKTOP 1033 "Create a Desktop shortcut"
LangString CUSTOM_LABEL_STARTMENU 1033 "The application will be installed in your user directory and accessible from the Windows Start Menu."

# 1034 = Spanish
LangString CUSTOM_OPTIONS_TITLE 1034 "Opciones de instalacion"
LangString CUSTOM_OPTIONS_SUBTITLE 1034 "Seleccione los accesos directos a crear para DesktopServer:"
LangString CUSTOM_CHECKBOX_DESKTOP 1034 "Crear un acceso directo en el Escritorio"
LangString CUSTOM_LABEL_STARTMENU 1034 "La aplicacion se instalara en su perfil de usuario y estara accesible desde el menu Inicio de Windows."

# 1031 = German
LangString CUSTOM_OPTIONS_TITLE 1031 "Installationsoptionen"
LangString CUSTOM_OPTIONS_SUBTITLE 1031 "Waehlen Sie die Verknuepfungen fuer DesktopServer aus:"
LangString CUSTOM_CHECKBOX_DESKTOP 1031 "Desktop-Verknuepfung erstellen"
LangString CUSTOM_LABEL_STARTMENU 1031 "Die Anwendung wird in Ihrem Benutzerprofil installiert und ueber das Windows-Startmenue aufrufbar sein."

# 1046 = Portuguese (Brazil)
LangString CUSTOM_OPTIONS_TITLE 1046 "Opcoes de instalacao"
LangString CUSTOM_OPTIONS_SUBTITLE 1046 "Selecione os atalhos a criar para o DesktopServer:"
LangString CUSTOM_CHECKBOX_DESKTOP 1046 "Criar um atalho na Area de Trabalho"
LangString CUSTOM_LABEL_STARTMENU 1046 "O aplicativo sera instalado no seu perfil de usuario e estara acessivel no menu Iniciar do Windows."

# 2070 = Portuguese (Portugal)
LangString CUSTOM_OPTIONS_TITLE 2070 "Opcoes de instalacao"
LangString CUSTOM_OPTIONS_SUBTITLE 2070 "Selecione os atalhos a criar para o DesktopServer:"
LangString CUSTOM_CHECKBOX_DESKTOP 2070 "Criar um atalho na Area de Trabalho"
LangString CUSTOM_LABEL_STARTMENU 2070 "O aplicativo sera instalado no seu perfil de usuario e estara acessivel no menu Iniciar do Windows."

Function ShowCustomOptionsPage
  nsDialogs::Create 1018
  Pop $CustomOptionsDialog
  ${If} $CustomOptionsDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 10u 10u 280u 16u $(CUSTOM_OPTIONS_SUBTITLE)
  Pop $0

  ${NSD_CreateCheckbox} 10u 35u 280u 14u $(CUSTOM_CHECKBOX_DESKTOP)
  Pop $CheckboxDesktopShortcut
  ${If} $DesktopShortcutCheckboxState == ""
    ${NSD_SetState} $CheckboxDesktopShortcut ${BST_CHECKED}
  ${Else}
    ${NSD_SetState} $CheckboxDesktopShortcut $DesktopShortcutCheckboxState
  ${EndIf}

  ${NSD_CreateLabel} 10u 60u 280u 35u $(CUSTOM_LABEL_STARTMENU)
  Pop $0

  nsDialogs::Show
FunctionEnd

Function LeaveCustomOptionsPage
  ${NSD_GetState} $CheckboxDesktopShortcut $DesktopShortcutCheckboxState
FunctionEnd

!macro customPageAfterChangeDir
  Page custom ShowCustomOptionsPage LeaveCustomOptionsPage
!macroend

!macro customInit
  ${If} ${Silent}
    Sleep 1500
    nsExec::Exec 'taskkill /F /IM DesktopServer.exe'
    Sleep 500
  ${EndIf}
!macroend

!macro customInstallmode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
  # 1. Gestion du raccourci sur le Bureau selon le choix utilisateur
  ${If} $DesktopShortcutCheckboxState == 0
    Delete "$newDesktopLink"
    Delete "$DESKTOP\${APP_PRODUCT_FILENAME}.lnk"
    Delete "$DESKTOP\DesktopServer.lnk"
  ${EndIf}

  # 2. Sauvegarde de la langue d'installation pour l'application
  ${If} $LANGUAGE == 1036
    FileOpen $0 "$INSTDIR\default-language.json" w
    FileWrite $0 '{"language":"fr"}'
    FileClose $0
  ${ElseIf} $LANGUAGE == 1033
    FileOpen $0 "$INSTDIR\default-language.json" w
    FileWrite $0 '{"language":"en"}'
    FileClose $0
  ${ElseIf} $LANGUAGE == 1034
    FileOpen $0 "$INSTDIR\default-language.json" w
    FileWrite $0 '{"language":"es"}'
    FileClose $0
  ${ElseIf} $LANGUAGE == 1031
    FileOpen $0 "$INSTDIR\default-language.json" w
    FileWrite $0 '{"language":"de"}'
    FileClose $0
  ${ElseIf} $LANGUAGE == 1046
    FileOpen $0 "$INSTDIR\default-language.json" w
    FileWrite $0 '{"language":"pt"}'
    FileClose $0
  ${ElseIf} $LANGUAGE == 2070
    FileOpen $0 "$INSTDIR\default-language.json" w
    FileWrite $0 '{"language":"pt"}'
    FileClose $0
  ${Else}
    FileOpen $0 "$INSTDIR\default-language.json" w
    FileWrite $0 '{"language":"fr"}'
    FileClose $0
  ${EndIf}

  # 3. Redemarrage automatique apres mise a jour silencieuse
  ${If} ${Silent}
    Exec '"$INSTDIR\DesktopServer.exe"'
  ${EndIf}
!macroend

!endif

!macro customUnInstall
  Delete "$INSTDIR\default-language.json"
!macroend
