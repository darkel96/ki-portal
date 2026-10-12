<#
.SYNOPSIS
  Richtet die App-Registrierung des KI-Hubs in Microsoft Entra ID für Copilot über Microsoft Graph ein.

.DESCRIPTION
  - legt die App-Registrierung „KI-Hub“ an oder nimmt eine bestehende (-ClientId)
  - trägt die Weiterleitungsadressen als „Single-page application“ ein (bestehende bleiben erhalten)
  - trägt die sieben delegierten Graph-Berechtigungen der Copilot-Chat-API ein
  - versucht die Administratorzustimmung (klappt nur mit passender Admin-Rolle)
  - gibt am Ende Client-ID und Tenant-ID für das KI-Menü des Hubs aus

  Voraussetzung: Azure CLI (winget install -e --id Microsoft.AzureCLI), danach PowerShell neu öffnen.

.EXAMPLE
  .\entra-einrichten.ps1
  .\entra-einrichten.ps1 -ClientId 1a2b3c4d-...    # bestehende Registrierung (z. B. EPLAN/Visio) erweitern
#>
param(
  [string]$ClientId,
  [string]$Name = "KI-Hub",
  [string[]]$RedirectUris = @(
    "https://darkel96.github.io/ki-portal/auth-redirect.html",
    "http://localhost:5173/auth-redirect.html"
  )
)
# Fehler von az über $LASTEXITCODE prüfen (Windows PowerShell 5.1 macht aus stderr sonst Abbrüche)
$ErrorActionPreference = "Continue"
$GRAPH = "00000003-0000-0000-c000-000000000000"
$SCOPES = "Sites.Read.All", "Mail.Read", "People.Read.All", "OnlineMeetingTranscript.Read.All",
          "Chat.Read", "ChannelMessage.Read.All", "ExternalItem.Read.All"

function Az { $out = & az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') ist fehlgeschlagen." }; $out -join "`n" }

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

# 3. Weiterleitungsadressen als „Single-page application“ (bestehende behalten)
$spa = @($app.spa.redirectUris) + $RedirectUris | Where-Object { $_ } | Select-Object -Unique
$tmp = New-TemporaryFile
# UTF-8 ohne BOM, sonst lehnt az rest den Inhalt ab
[IO.File]::WriteAllText($tmp.FullName, (@{ spa = @{ redirectUris = @($spa) } } | ConvertTo-Json -Depth 4))
Az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$($app.id)" --headers "Content-Type=application/json" --body "@$($tmp.FullName)" | Out-Null
Remove-Item $tmp
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

# 5. Dienstprinzipal (Unternehmensanwendung) sicherstellen, dann Administratorzustimmung
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
