; =============================================================================
; Flowtix ERP — Windows Installer (FT-DEP-001 Batch 10 / Milestone 2)
; Inno Setup 6 wrapper only — orchestrates Batches 1–9; does not redesign deploy.
;
; Build: deployment\installer\build-installer.bat
; Requires: Inno Setup 6 (ISCC.exe), release package from create-release.bat
;
; URL policy:
;   - Server shortcut uses http://127.0.0.1:<PORT>/ (PORT from shared\.env or 4000)
;   - LAN clients use http://<hostname-or-IPv4>:<PORT>/ (documented in LAN-ACCESS.txt)
;   - Single port source: shared\.env PORT (same as production.env.example)
; =============================================================================

#define MyAppName "Flowtix ERP"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Flowtix / DankelTek"
#define MyAppExeName "FlowtixERP.url"
#define ReleaseFolder "Flowtix-v" + MyAppVersion
#define DefaultPort "4000"

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
CloseApplications=no
RestartApplications=no
SetupLogging=yes
InfoAfterFile=info-after.txt
; SignTool=signtool $f   ; optional Authenticode — see README.md

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut (opens server localhost URL)"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "installservice"; Description: "Install optional &Windows Service (Batch 8 / WinSW)"; GroupDescription: "Service:"; Flags: unchecked
Name: "configurefirewall"; Description: "Allow LAN clients through Windows &Firewall (app PORT)"; GroupDescription: "Network:"; Flags: unchecked
Name: "skipmigrate"; Description: "Skip database migrate (Path B — folders/app only)"; GroupDescription: "Database:"; Flags: unchecked

[Files]
Source: "{#ReleaseRoot}\*"; DestDir: "{app}\releases\{#ReleaseFolder}"; Flags: ignoreversion recursesubdirs createallsubdirs uninsneveruninstall
Source: "post-install.bat"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "license.txt"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "info-after.txt"; DestDir: "{app}\tools"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Open Install Folder"; Filename: "{app}"
Name: "{group}\LAN Access Notes"; Filename: "{app}\LAN-ACCESS.txt"
Name: "{group}\Run Setup Tools"; Filename: "explorer.exe"; Parameters: """{app}\releases\{#ReleaseFolder}\tools"""
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{cmd}"; Parameters: "/C ""{app}\tools\post-install.bat"" ""{app}"" ""{app}\releases\{#ReleaseFolder}"" {code:SkipMigrateFlag} {code:InstallServiceFlag} {code:ConfigureFirewallFlag}"; StatusMsg: "Running Flowtix setup (Batch 9)..."; Flags: runhidden waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Description: "Open {#MyAppName} (this server)"; Flags: postinstall nowait skipifsilent shellexec
Filename: "{app}\LAN-ACCESS.txt"; Description: "View LAN client access URLs"; Flags: postinstall nowait skipifsilent shellexec unchecked

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C if exist ""{app}\releases\{#ReleaseFolder}\tools\service-stop.bat"" (call ""{app}\releases\{#ReleaseFolder}\tools\service-stop.bat"" --home ""{app}"") else if exist ""{app}\tools\service-stop.bat"" (call ""{app}\tools\service-stop.bat"" --home ""{app}"")"; Flags: runhidden waituntilterminated; RunOnceId: "StopSvc"
Filename: "{cmd}"; Parameters: "/C if exist ""{app}\releases\{#ReleaseFolder}\tools\service-uninstall.bat"" (call ""{app}\releases\{#ReleaseFolder}\tools\service-uninstall.bat"" --home ""{app}"") else if exist ""{app}\tools\service-uninstall.bat"" (call ""{app}\tools\service-uninstall.bat"" --home ""{app}"")"; Flags: runhidden waituntilterminated; RunOnceId: "UninstSvc"
Filename: "{cmd}"; Parameters: "/C if exist ""{app}\releases\{#ReleaseFolder}\tools\firewall-flowtix.bat"" (call ""{app}\releases\{#ReleaseFolder}\tools\firewall-flowtix.bat"" remove) else if exist ""{app}\tools\firewall-flowtix.bat"" (call ""{app}\tools\firewall-flowtix.bat"" remove)"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFw"

[Code]
var
  ResolvedPort: String;

function SkipMigrateFlag(Param: String): String;
begin
  if WizardIsTaskSelected('skipmigrate') then
    Result := '1'
  else
    Result := '0';
end;

function InstallServiceFlag(Param: String): String;
begin
  if WizardIsTaskSelected('installservice') then
    Result := '1'
  else
    Result := '0';
end;

function ConfigureFirewallFlag(Param: String): String;
begin
  if WizardIsTaskSelected('configurefirewall') then
    Result := '1'
  else
    Result := '0';
end;

function TrimQuotes(S: String): String;
var
  T: String;
begin
  T := Trim(S);
  Result := T;
  if Length(T) < 2 then
    Exit;
  { Strip matching double quotes only (avoid Pascal quote-literal pitfalls). }
  if (T[1] = '"') and (T[Length(T)] = '"') then
    Result := Copy(T, 2, Length(T) - 2);
end;

{ Single port source: shared\.env PORT, else default 4000 (production.env.example). }
function ResolveAppPort(): String;
var
  EnvPath: String;
  Lines: TArrayOfString;
  Line: String;
  I, Eq: Integer;
  UpperLine: String;
begin
  Result := '{#DefaultPort}';
  EnvPath := ExpandConstant('{app}\shared\.env');
  if not FileExists(EnvPath) then
    Exit;
  if not LoadStringsFromFile(EnvPath, Lines) then
    Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Line := Trim(Lines[I]);
    if (Line = '') or (Line[1] = '#') then
      Continue;
    UpperLine := Uppercase(Line);
    if Pos('PORT=', UpperLine) = 1 then
    begin
      Eq := Pos('=', Line);
      Result := TrimQuotes(Copy(Line, Eq + 1, Length(Line) - Eq));
      if Result = '' then
        Result := '{#DefaultPort}';
      Exit;
    end;
  end;
end;

function InitializeSetup(): Boolean;
var
  ReleasePath: String;
begin
  Result := True;
  ResolvedPort := '{#DefaultPort}';
  ReleasePath := ExpandConstant('{#ReleaseRoot}');
  if not FileExists(ReleasePath + '\VERSION.txt') then
  begin
    MsgBox('Release package not found:'#13#10 + ReleasePath + #13#10#13#10 +
      'Run deployment\create-release.bat first, then build-installer.bat.',
      mbError, MB_OK);
    Result := False;
  end;
end;

procedure WriteAccessFiles(Port: String);
var
  ServerUrl, HostName, LanNotes, Shortcut: String;
begin
  ServerUrl := 'http://127.0.0.1:' + Port + '/';
  HostName := GetComputerNameString();
  Shortcut :=
    '[InternetShortcut]' + #13#10 +
    'URL=' + ServerUrl + #13#10 +
    'IconIndex=0' + #13#10;
  SaveStringToFile(ExpandConstant('{app}\{#MyAppExeName}'), Shortcut, False);

  LanNotes :=
    'Flowtix ERP — Client Access' + #13#10 +
    '================================' + #13#10 +
    '' + #13#10 +
    'Port source: shared\.env PORT (default ' + '{#DefaultPort}' + ').' + #13#10 +
    'Do not invent a second port configuration.' + #13#10 +
    '' + #13#10 +
    'This server (shortcut / localhost):' + #13#10 +
    '  ' + ServerUrl + #13#10 +
    '' + #13#10 +
    'LAN browser clients (other PCs on the network):' + #13#10 +
    '  http://' + HostName + ':' + Port + '/' + #13#10 +
    '  http://<this-server-LAN-IPv4>:' + Port + '/' + #13#10 +
    '' + #13#10 +
    'The Node/Express backend serves the packaged React UI from web\ ' + #13#10 +
    'and the API under /api/*. Health: GET /health' + #13#10 +
    '' + #13#10 +
    'Firewall (optional):' + #13#10 +
    '  tools\firewall-flowtix.bat add --home "' + ExpandConstant('{app}') + '"' + #13#10 +
    '  tools\firewall-flowtix.bat verify' + #13#10 +
    '' + #13#10 +
    'MySQL is installed separately (not by this installer).' + #13#10;

  SaveStringToFile(ExpandConstant('{app}\LAN-ACCESS.txt'), LanNotes, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  LogDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    LogDir := ExpandConstant('{app}\logs');
    ForceDirectories(LogDir);
    ResolvedPort := ResolveAppPort();
    WriteAccessFiles(ResolvedPort);
    MsgBox(
      'Flowtix ERP installed.'#13#10#13#10 +
      'Server URL (this PC):'#13#10 +
      '  http://127.0.0.1:' + ResolvedPort + '/'#13#10#13#10 +
      'LAN clients:'#13#10 +
      '  http://' + GetComputerNameString() + ':' + ResolvedPort + '/'#13#10 +
      '  http://<server-LAN-IPv4>:' + ResolvedPort + '/'#13#10#13#10 +
      'Details: ' + ExpandConstant('{app}\LAN-ACCESS.txt') + #13#10 +
      'Port comes from shared\.env PORT (default {#DefaultPort}).',
      mbInformation, MB_OK);
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  MsgBox('Uninstall stops the Windows Service (if installed), removes the firewall rule if present, and removes application binaries.'#13#10#13#10 +
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
  if CurUninstallStep = usPostUninstall then
  begin
    AppDir := ExpandConstant('{app}');
    DelTree(AppDir + '\app', True, True, True);
    DelTree(AppDir + '\web', True, True, True);
    DelTree(AppDir + '\prisma', True, True, True);
    DeleteFile(AppDir + '\VERSION.txt');
    DeleteFile(AppDir + '\{#MyAppExeName}');
    DeleteFile(AppDir + '\LAN-ACCESS.txt');
  end;
end;
