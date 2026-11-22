; CloudBox NSIS installer customization.
; app.setLoginItemSettings writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
; electron-builder's default uninstaller does not remove that value.

!macro customUnInstall
  ; Manual uninstall asks whether data should be deleted. Silent updates keep data.
  IfSilent CloudBoxKeepData
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除所有用户数据（账号、文件、配置）？$\r$\nDelete all user data (accounts, files, configuration)?" IDNO CloudBoxKeepData
  RMDir /r "$APPDATA\cloudbox"
  RMDir /r "$PROGRAMDATA\CloudBox"
  CloudBoxKeepData:
  ; Current value name (explicitly set by src/main/loginItem.ts)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CloudBox"

  ; Legacy names written before the explicit name was added.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.cloudbox.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CloudBox.exe"

  ; Windows may also remember startup approval state separately.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "CloudBox"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.cloudbox.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "CloudBox.exe"
!macroend
