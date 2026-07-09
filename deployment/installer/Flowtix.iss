; =============================================================================
; Flowtix ERP — Windows Installer (FT-DEP-001 Batch 10)
; Inno Setup 6 wrapper only — orchestrates Batches 1–9; does not redesign deploy.
;
; Build: deployment\installer\build-installer.bat
; Requires: Inno Setup 6 (ISCC.exe), release package from create-release.bat
; =============================================================================

#define MyAppName "Flowtix ERP"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Flowtix / DankelTek"
#define MyAppURL "http://127.0.0.1:4000"
#define MyAppExeName "FlowtixERP.url"
#define ReleaseFolder "Flowtix-v" + MyAppVersion

#ifndef ReleaseRoot
  #define ReleaseRoot "..\..\release\" + ReleaseFolder
#endif

#ifndef OutputDir
  #define OutputDir "output"
#endif

[Setup]
AppId={{A7F3C2E1-9B4D-4E8A-B1C0-8D2E5F6A7B90}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName=C:\FT-ERP
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
LicenseFile=license.txt
OutputDir={#OutputDir}
OutputBaseFilename=Flowtix-Setup-v{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName} {#MyAppVersion}
; Keep data by default — see [UninstallDelete] / [Code]
CloseApplications=no
RestartApplications=no
SetupLogging=yes
; SignTool=signtool $f   ; optional Authenticode — see README.md (not required for Batch 10)

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "installservice"; Description: "Install optional &Windows Service (Batch 8 / WinSW)"; GroupDescription: "Service:"; Flags: unchecked
Name: "skipmigrate"; Description: "Skip database migrate (Path B — folders/app only)"; GroupDescription: "Database:"; Flags: unchecked

[Files]
; Certified release package (Batch 1 output) → {app}\releases\Flowtix-vX.Y.Z\
; uninsneveruninstall: keep releases\ (and any sibling *-pre-update-* archives) on uninstall
Source: "{#ReleaseRoot}\*"; DestDir: "{app}\releases\{#ReleaseFolder}"; Flags: ignoreversion recursesubdirs createallsubdirs uninsneveruninstall
; Installer helper (not a substitute for tools\setup-flowtix)
Source: "post-install.bat"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "license.txt"; DestDir: "{app}\tools"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Open Install Folder"; Filename: "{app}"
Name: "{group}\Run Setup Tools"; Filename: "explorer.exe"; Parameters: """{app}\releases\{#ReleaseFolder}\tools"""
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Post-install: Batch 9 setup (and optional service via setup flags). Existing install → no-op.
Filename: "{cmd}"; Parameters: "/C ""{app}\tools\post-install.bat"" ""{app}"" ""{app}\releases\{#ReleaseFolder}"" {code:SkipMigrateFlag} {code:InstallServiceFlag}"; StatusMsg: "Running Flowtix setup (Batch 9)..."; Flags: runhidden waituntilterminated
; Optional launch (browser to local URL)
Filename: "{app}\{#MyAppExeName}"; Description: "Open {#MyAppName}"; Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
; Stop/remove Windows Service if present (Batch 8) — never touch MySQL / shared / backups / logs
Filename: "{cmd}"; Parameters: "/C if exist ""{app}\releases\{#ReleaseFolder}\tools\service-stop.bat"" (call ""{app}\releases\{#ReleaseFolder}\tools\service-stop.bat"" --home ""{app}"") else if exist ""{app}\tools\service-stop.bat"" (call ""{app}\tools\service-stop.bat"" --home ""{app}"")"; Flags: runhidden waituntilterminated; RunOnceId: "StopSvc"
Filename: "{cmd}"; Parameters: "/C if exist ""{app}\releases\{#ReleaseFolder}\tools\service-uninstall.bat"" (call ""{app}\releases\{#ReleaseFolder}\tools\service-uninstall.bat"" --home ""{app}"") else if exist ""{app}\tools\service-uninstall.bat"" (call ""{app}\tools\service-uninstall.bat"" --home ""{app}"")"; Flags: runhidden waituntilterminated; RunOnceId: "UninstSvc"

[Code]
function SkipMigrateFlag(Param: String): String;
begin
  if IsTaskSelected('skipmigrate') then
    Result := '1'
  else
    Result := '0';
end;

function InstallServiceFlag(Param: String): String;
begin
  if IsTaskSelected('installservice') then
    Result := '1'
  else
    Result := '0';
end;

function InitializeSetup(): Boolean;
var
  ReleasePath: String;
begin
  Result := True;
  ReleasePath := ExpandConstant('{#ReleaseRoot}');
  if not FileExists(ReleasePath + '\VERSION.txt') then
  begin
    MsgBox('Release package not found:'#13#10 + ReleasePath + #13#10#13#10 +
      'Run deployment\create-release.bat first, then build-installer.bat.',
      mbError, MB_OK);
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  LogDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    LogDir := ExpandConstant('{app}\logs');
    ForceDirectories(LogDir);
    { Create a simple URL shortcut for LAN UI }
    SaveStringToFile(ExpandConstant('{app}\{#MyAppExeName}'),
      '[InternetShortcut]'#13#10 +
      'URL={#MyAppURL}'#13#10 +
      'IconIndex=0'#13#10, False);
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  MsgBox('Uninstall stops the Windows Service (if installed) and removes application binaries.'#13#10#13#10 +
    'By default this does NOT delete:'#13#10 +
    '  - shared\ (including .env and uploads)'#13#10 +
    '  - backups\'#13#10 +
    '  - logs\'#13#10 +
    '  - prior release archives under releases\*-pre-update-*'#13#10 +
    '  - MySQL database'#13#10#13#10 +
    'Use update-flowtix / rollback-flowtix for version changes; uninstall is not a DB wipe.',
    mbInformation, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppDir: String;
begin
  { Remove active app/web placed by Batch 9 setup — never shared/backups/logs }
  if CurUninstallStep = usPostUninstall then
  begin
    AppDir := ExpandConstant('{app}');
    DelTree(AppDir + '\app', True, True, True);
    DelTree(AppDir + '\web', True, True, True);
    DelTree(AppDir + '\prisma', True, True, True);
    DeleteFile(AppDir + '\VERSION.txt');
    DeleteFile(AppDir + '\{#MyAppExeName}');
  end;
end;
