# Creates or re-keys the mcp_readonly MySQL user (see 03-create-mcp-user.sql).
#
# Required env:  MCP_DB_PASSWORD   password for mcp_readonly
# Optional env:  MCP_ADMIN_USER (default root), MCP_DB_HOST (127.0.0.1), MCP_DB_PORT (3306),
#                MYSQL_PWD (admin password, read by the mysql client; stdin is not a terminal)
#
# The password goes to mysql on stdin only, never in the argument list.
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($env:MCP_DB_PASSWORD)) {
    Write-Error 'MCP_DB_PASSWORD is not set or is empty. Nothing was created.'
    exit 1
}

$mysql = Get-Command mysql -ErrorAction SilentlyContinue
if (-not $mysql) { Write-Error 'The mysql client was not found on PATH.'; exit 1 }

$sqlFile = Join-Path $PSScriptRoot '03-create-mcp-user.sql'
if (-not (Test-Path -LiteralPath $sqlFile)) { Write-Error "Cannot read $sqlFile"; exit 1 }

$dbHost = if ($env:MCP_DB_HOST)    { $env:MCP_DB_HOST }    else { '127.0.0.1' }
$dbPort = if ($env:MCP_DB_PORT)    { $env:MCP_DB_PORT }    else { '3306' }
$admin  = if ($env:MCP_ADMIN_USER) { $env:MCP_ADMIN_USER } else { 'root' }

# Escape for a single-quoted MySQL string literal: backslash first, then single quote.
$pw = $env:MCP_DB_PASSWORD.Replace('\', '\\').Replace("'", "\'")
$utf8 = New-Object System.Text.UTF8Encoding($false)   # no BOM
$payload = "SET @mcp_pw := '$pw';`n" + [System.IO.File]::ReadAllText($sqlFile, $utf8)

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $mysql.Source
# Arguments hold no secret. A single string works on Windows PowerShell 5.1 and PowerShell 7.
$psi.Arguments = "--protocol=TCP --host=`"$dbHost`" --port=`"$dbPort`" --user=`"$admin`" --default-character-set=utf8mb4"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.StandardInputEncoding = $utf8

$proc = [System.Diagnostics.Process]::Start($psi)
$proc.StandardInput.Write($payload)
$proc.StandardInput.Close()
$proc.WaitForExit()
$pw = $null; $payload = $null

if ($proc.ExitCode -ne 0) {
    Write-Error "mysql exited with code $($proc.ExitCode); mcp_readonly may not be fully configured."
    exit $proc.ExitCode
}
Write-Output 'mcp_readonly is ready (password set, SELECT on the five vw_* views, max 5 connections).'
