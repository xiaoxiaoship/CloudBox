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
Source: "..\..\dist\headless\*"; DestDir: "{app}\dist\headless"; Flags: recursesubdirs createallsubdirs
Source: "..\..\dist\admin\*"; DestDir: "{app}\dist\admin"; Flags: recursesubdirs createallsubdirs
Source: "..\..\dist\web\*"; DestDir: "{app}\dist\web"; Flags: recursesubdirs createallsubdirs
Source: "..\..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs
Source: "..\..\resources\*"; DestDir: "{app}\resources"; Flags: recursesubdirs createallsubdirs
Source: "..\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\winsw\CloudBoxService.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\winsw\CloudBoxService.exe"; DestDir: "{app}"; Flags: ignoreversion

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
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
