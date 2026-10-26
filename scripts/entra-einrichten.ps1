<#
.SYNOPSIS
  Richtet die App-Registrierung des KI-Hubs in Microsoft Entra ID für Copilot über Microsoft Graph ein.

.DESCRIPTION
  - legt die App-Registrierung „KI-Hub“ an oder nimmt eine bestehende (-ClientId)
  - trägt die Weiterleitungsadressen als „Single-page application“ ein (bestehende bleiben erhalten)
  - trägt die sieben delegierten Graph-Berechtigungen der Copilot-Chat-API ein
  - versucht die Administratorzustimmung (klappt nur mit passender Admin-Rolle)
  - gibt am Ende Client-ID und Tenant-ID für das KI-Menü des Hubs aus

  Mit -Dienst zusätzlich alles für den Hub-Dienst (server/, siehe SERVER.md):
  - Berechtigungen für Zustellung und Wissensquellen (Mail.Send, Chat.ReadWrite, ChatMessage.Send, Calendars.Read,
    Team.ReadBasic.All, Channel.ReadBasic.All) und offline_access (der Dienst arbeitet ohne offenen Browser weiter)
  - eigene API api://<Client-ID> mit dem Bereich Laeufe.Ausfuehren, der Hub als autorisierter Client
  - neuer Clientschlüssel „Hub-Dienst“ (2 Jahre) und ein Schlüssel für die verschlüsselte Ablage (HUB_SCHLUESSEL)
  - gibt die fertigen Zeilen für server/.env aus; mit -EnvDatei werden sie dort eingetragen (vorhandene Werte bleiben)

  Voraussetzung: Azure CLI (winget install -e --id Microsoft.AzureCLI), danach PowerShell neu öffnen.

.EXAMPLE
  .\entra-einrichten.ps1
  .\entra-einrichten.ps1 -ClientId 1a2b3c4d-...    # bestehende Registrierung (z. B. EPLAN/Visio) erweitern
  .\entra-einrichten.ps1 -ClientId 1a2b3c4d-... -Dienst -DienstHost ki-hub.firma.de -EnvDatei ..\server\.env
#>
param(
  [string]$ClientId,
  [string]$Name = "KI-Hub",
  [string[]]$RedirectUris = @(
    "https://darkel96.github.io/ki-portal/auth-redirect.html",
    "http://localhost:5173/auth-redirect.html"
  ),
  # Zusätzlich den Hub-Dienst einrichten (API, Clientschlüssel, weitere Berechtigungen)
  [switch]$Dienst,
  # DNS-Name des Servers, der den Hub ausliefert (z. B. ki-hub.firma.de): ergibt die Weiterleitungsadresse
  [string]$DienstHost,
  # Datei, in die die Werte für den Dienst eingetragen werden (z. B. ..\server\.env); fehlt sie, wird sie angelegt
  [string]$EnvDatei
)
# Fehler von az über $LASTEXITCODE prüfen (Windows PowerShell 5.1 macht aus stderr sonst Abbrüche)
$ErrorActionPreference = "Continue"
$GRAPH = "00000003-0000-0000-c000-000000000000"
$SCOPES = "Sites.Read.All", "Mail.Read", "People.Read.All", "OnlineMeetingTranscript.Read.All",
          "Chat.Read", "ChannelMessage.Read.All", "ExternalItem.Read.All"
$SCOPES_DIENST = "Mail.Send", "Chat.ReadWrite", "ChatMessage.Send", "Calendars.Read", "Team.ReadBasic.All",
                 "Channel.ReadBasic.All", "offline_access"
if ($Dienst) { $SCOPES = $SCOPES + $SCOPES_DIENST }
if ($Dienst -and $DienstHost) { $RedirectUris = $RedirectUris + "https://$DienstHost/auth-redirect.html" }

function Az { $out = & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') ist fehlgeschlagen." }; $out -join "`n" }
# JSON-Körper für az rest: UTF-8 ohne BOM, sonst lehnt az rest den Inhalt ab
function AzPatch([string]$uri, $body) {
  $tmp = New-TemporaryFile
  [IO.File]::WriteAllText($tmp.FullName, ($body | ConvertTo-Json -Depth 8))
  try { Az rest --method PATCH --uri $uri --headers "Content-Type=application/json" --body "@$($tmp.FullName)" | Out-Null }
  finally { Remove-Item $tmp }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI fehlt. Installieren mit: winget install -e --id Microsoft.AzureCLI  (danach PowerShell neu öffnen)"
}

# 1. Anmelden (Firmenkonto im Browser)
$konto = (& az account show 2>$null) -join "`n" | ConvertFrom-Json
if (-not $konto) { Az login --allow-no-subscriptions | Out-Null; $konto = Az account show | ConvertFrom-Json }
$tenantId = $konto.tenantId
Write-Host "Angemeldet als $($konto.user.name), Tenant $tenantId"

# 2. App-Registrierung finden oder anlegen
if ($ClientId) {
  $app = Az ad app show --id $ClientId | ConvertFrom-Json
  Write-Host "Bestehende Registrierung: $($app.displayName)"
} else {
  $app = Az ad app create --display-name $Name --sign-in-audience AzureADMyOrg | ConvertFrom-Json
  Write-Host "Neue Registrierung angelegt: $Name"
}
$appUri = "https://graph.microsoft.com/v1.0/applications/$($app.id)"

# 3. Weiterleitungsadressen als „Single-page application“ (bestehende behalten)
$spa = @($app.spa.redirectUris) + $RedirectUris | Where-Object { $_ } | Select-Object -Unique
AzPatch $appUri @{ spa = @{ redirectUris = @($spa) } }
Write-Host "Single-page application: $($spa -join ', ')"

# 4. Delegierte Graph-Berechtigungen (IDs aus dem Graph-Dienstprinzipal des Tenants)
$graphSp = Az ad sp show --id $GRAPH | ConvertFrom-Json
$ids = foreach ($s in $SCOPES) {
  $id = ($graphSp.oauth2PermissionScopes | Where-Object { $_.value -eq $s }).id
  if (-not $id) { throw "Berechtigung $s nicht gefunden." }
  "$id=Scope"
}
Az ad app permission add --id $app.appId --api $GRAPH --api-permissions @ids | Out-Null
Write-Host "Graph-Berechtigungen eingetragen: $($SCOPES -join ', ')"

# 5. Hub-Dienst: eigene API mit Bereich Laeufe.Ausfuehren, Hub als autorisierter Client, Clientschlüssel
$envZeilen = @()
if ($Dienst) {
  $app = Az ad app show --id $app.appId | ConvertFrom-Json
  $apiUri = "api://$($app.appId)"
  $bereiche = @($app.api.oauth2PermissionScopes)
  $bereich = $bereiche | Where-Object { $_.value -eq "Laeufe.Ausfuehren" }
  if (-not $bereich) {
    $bereich = [pscustomobject]@{
      id = [guid]::NewGuid().ToString(); value = "Laeufe.Ausfuehren"; type = "User"; isEnabled = $true
      adminConsentDisplayName = "Läufe im KI-Hub-Dienst ausführen"
      adminConsentDescription = "Erlaubt dem KI-Hub-Dienst, Läufe und Aufträge im Namen der Person auszuführen."
      userConsentDisplayName = "Läufe im KI-Hub-Dienst ausführen"
      userConsentDescription = "Erlaubt dem KI-Hub-Dienst, Läufe und Aufträge in deinem Namen auszuführen."
    }
    $bereiche = @($bereiche) + $bereich
    $uris = @($app.identifierUris) + $apiUri | Where-Object { $_ } | Select-Object -Unique
    AzPatch $appUri @{ identifierUris = @($uris); api = @{ oauth2PermissionScopes = @($bereiche) } }
    Write-Host "API verfügbar gemacht: $apiUri, Bereich Laeufe.Ausfuehren"
  } else {
    Write-Host "API vorhanden: $apiUri, Bereich Laeufe.Ausfuehren"
  }
  # Der Hub selbst darf den Bereich ohne weitere Zustimmungsabfrage nutzen
  $vorab = @($app.api.preAuthorizedApplications | Where-Object { $_.appId -ne $app.appId })
  $vorab += [pscustomobject]@{ appId = $app.appId; delegatedPermissionIds = @($bereich.id) }
  AzPatch $appUri @{ api = @{ preAuthorizedApplications = @($vorab) } }
  Write-Host "Hub als autorisierter Client eingetragen"

  # Neuer Clientschlüssel (wird nur einmal angezeigt; alte Schlüssel bleiben gültig)
  $geheim = Az ad app credential reset --id $app.appId --append --display-name "Hub-Dienst" --years 2 --query password -o tsv
  $geheim = $geheim.Trim()
  Write-Host "Clientschlüssel „Hub-Dienst“ angelegt (gültig 2 Jahre)"
  # Schlüssel für die verschlüsselte Ablage der Anmeldungen (64 Hex-Zeichen)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32; $rng.GetBytes($bytes)
  $schluessel = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

  $envZeilen = @(
    "HUB_TENANT_ID=$tenantId",
    "HUB_CLIENT_ID=$($app.appId)",
    "HUB_CLIENT_SECRET=$geheim",
    "HUB_SCHLUESSEL=$schluessel",
    "HUB_URSPRUNG=https://darkel96.github.io",
    "HUB_GIT_REPO=darkel96/ki-portal",
    "VITE_ENTRA_CLIENT_ID=$($app.appId)",
    "VITE_ENTRA_TENANT_ID=$tenantId"
  )
}

# 6. Dienstprinzipal (Unternehmensanwendung) sicherstellen, dann Administratorzustimmung
#    (braucht z. B. die Rolle „Cloudanwendungsadministrator“)
& az ad sp show --id $app.appId 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Az ad sp create --id $app.appId | Out-Null }
& az ad app permission admin-consent --id $app.appId 2>$null | Out-Null
$zustimmung = $LASTEXITCODE -eq 0

Write-Host ""
Write-Host "Fertig. Im KI-Hub oben rechts im KI-Menü unter „Mit Copilot testen“ eintragen:" -ForegroundColor Green
Write-Host "  Client-ID: $($app.appId)"
Write-Host "  Tenant-ID: $tenantId"
if (-not $zustimmung) {
  Write-Host ""
  Write-Host "Die Administratorzustimmung hat nicht geklappt (fehlende Admin-Rolle)." -ForegroundColor Yellow
  Write-Host "Die IT kann sie hier erteilen: Entra ID > App-Registrierungen > $($app.displayName) > API-Berechtigungen > Administratorzustimmung erteilen"
  Write-Host "oder per Link: https://login.microsoftonline.com/$tenantId/adminconsent?client_id=$($app.appId)"
}

if ($Dienst) {
  if ($EnvDatei) {
    # Vorhandene, ausgefüllte Werte bleiben; leere oder fehlende Zeilen werden gesetzt
    $pfad = if ([IO.Path]::IsPathRooted($EnvDatei)) { $EnvDatei } else { Join-Path (Get-Location).Path $EnvDatei }
    $zeilen = New-Object System.Collections.Generic.List[string]
    if (Test-Path $pfad) { foreach ($l in Get-Content $pfad -Encoding UTF8) { $zeilen.Add($l) } }
    foreach ($z in $envZeilen) {
      $name = ($z -split "=", 2)[0]
      $i = -1
      for ($k = 0; $k -lt $zeilen.Count; $k++) { if ($zeilen[$k] -match "^\s*$([regex]::Escape($name))\s*=") { $i = $k; break } }
      if ($i -lt 0) { $zeilen.Add($z) }
      elseif (($zeilen[$i] -split "=", 2)[1].Trim() -eq "") { $zeilen[$i] = $z }
      else { Write-Host "  $name bleibt wie in $EnvDatei" }
    }
    [IO.File]::WriteAllLines($pfad, $zeilen, (New-Object System.Text.UTF8Encoding $false))
    Write-Host ""
    Write-Host "Werte für den Hub-Dienst stehen in $EnvDatei (Datei nicht weitergeben, sie enthält den Clientschlüssel)." -ForegroundColor Green
  } else {
    Write-Host ""
    Write-Host "Diese Zeilen nach server/.env auf dem Server übernehmen (der Clientschlüssel wird nur jetzt angezeigt):" -ForegroundColor Green
    $envZeilen | ForEach-Object { Write-Host "  $_" }
  }
  Write-Host "Danach auf dem Server:  bash scripts/dienst-einrichten.sh"
}
