; CloudBox NSIS installer customization.
; app.setLoginItemSettings writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
; electron-builder's default uninstaller does not remove that value.

!macro customUnInstall
  ; The data-preservation prompt is injected into the electron-builder
  ; uninstaller by scripts/patch-nsis-uninstaller.mjs during packaging.
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
