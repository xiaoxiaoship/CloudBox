; CloudBox Windows Server installer.
; Build prerequisites:
;   npm run build:web
;   npm run build:admin
;   npm run build:headless
;   place WinSW as installer\winsw\CloudBoxService.exe
;   build with Inno Setup 6.
;
; Prerequisites are intentionally packaged by the release pipeline:
;   dist\headless, dist\admin, dist\web, node_modules, resources, node.exe

#define MyAppName "CloudBox"
#define MyAppVersion "1.0.2"
#define MyAppPublisher "CloudBox"
#define MyAppURL "https://github.com/xiaoxiaoship/CloudBox"

[Setup]
AppId={{7B7B1E8E-3C2D-4A74-9C78-2F5B1A7D9E11}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\CloudBox
DefaultGroupName=CloudBox
OutputDir=..\..\release
OutputBaseFilename=CloudBox-Server-{#MyAppVersion}-x64
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=CloudBox Server
WizardStyle=modern

[Files]
Source: "{#StageDir}\dist\headless\*"; DestDir: "{app}\dist\headless"; Flags: recursesubdirs createallsubdirs
Source: "{#StageDir}\dist\admin\*"; DestDir: "{app}\dist\admin"; Flags: recursesubdirs createallsubdirs
Source: "{#StageDir}\dist\web\*"; DestDir: "{app}\dist\web"; Flags: recursesubdirs createallsubdirs
Source: "{#StageDir}\node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs
Source: "{#StageDir}\resources\*"; DestDir: "{app}\resources"; Flags: recursesubdirs createallsubdirs
Source: "{#StageDir}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\CloudBoxService.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\CloudBoxService.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\CloudBox 管理端"; Filename: "http://127.0.0.1:1250/"
Name: "{group}\CloudBox 数据目录"; Filename: "{commonappdata}\CloudBox"
Name: "{group}\卸载 CloudBox"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\CloudBoxService.exe"; Parameters: "install"; Flags: runhidden waituntilterminated
Filename: "{app}\CloudBoxService.exe"; Parameters: "start"; Flags: runhidden waituntilterminated
Filename: "http://127.0.0.1:1250/"; Description: "打开 CloudBox 管理端"; Flags: postinstall shellexec unchecked

[UninstallRun]
Filename: "{app}\CloudBoxService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated
Filename: "{app}\CloudBoxService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated

[Code]
var
  DeleteUserData: Boolean;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  // Stop the existing WinSW service before replacing locked native modules.
  Exec('sc.exe', 'stop CloudBox', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(3000);
  Result := '';
end;

procedure DeleteCloudBoxData;
var
  ResultCode: Integer;
begin
  Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\resources\uninstall-cleanup.ps1') + '"' +
    ' -GuiPaths "' + ExpandConstant('{userappdata}\cloudbox\cloudbox-paths.json') + '"' +
    ' -ServerPaths "' + ExpandConstant('{commonappdata}\CloudBox\cloudbox-paths.json') + '"' +
    ' -DefaultAppData "' + ExpandConstant('{userappdata}\cloudbox') + '"' +
    ' -DefaultProgramData "' + ExpandConstant('{commonappdata}\CloudBox') + '"' +
    ' -AppRoot "' + ExpandConstant('{app}') + '" -DeleteDefaults',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  DelTree(ExpandConstant('{userappdata}\cloudbox'), True, True, True);
  DelTree(ExpandConstant('{commonappdata}\CloudBox'), True, True, True);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if DeleteUserData and (CurUninstallStep = usPostUninstall) then
  begin
    DeleteCloudBoxData;
  end;
end;

function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  // CLI: /VERYSILENT keeps data unless /DELETEAPPDATA is explicit.
  // Interactive: ask the user.
  if UninstallSilent then
  begin
    DeleteUserData := Pos('/DELETEAPPDATA', Uppercase(GetCmdTail)) > 0;
    if DeleteUserData then
    begin
      Exec('sc.exe', 'stop CloudBox', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Sleep(3000);
      DeleteCloudBoxData;
    end;
  end
  else
  begin
    if MsgBox('是否同时删除所有用户数据（账号、文件、配置）？' + #13#10 +
      'Delete all user data (accounts, files, configuration)?' + #13#10 +
      '选择“否”将保留 %APPDATA%\cloudbox 和 %PROGRAMDATA%\CloudBox，重装后可恢复。',
      mbConfirmation, MB_YESNO) = IDYES then
    begin
      DeleteUserData := True;
      Exec('sc.exe', 'stop CloudBox', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Sleep(3000);
      DeleteCloudBoxData;
    end;
  end;
end;
