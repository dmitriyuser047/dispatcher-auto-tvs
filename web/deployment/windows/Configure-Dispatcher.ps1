#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$InstallationRoot = '',
    [string]$DataDir = '',
    [string]$UsersFile = '',
    [string]$StateDir = '',
    [string]$BackupDir = '',
    [ValidateRange(1024, 65535)][int]$Port = 3381,
    [switch]$Lan,
    [string[]]$TrustedHost = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Dispatcher.Windows.psm1') -Force
$candidatePath = $null
try {
    $root = Get-DispatcherInstallationRoot -InstallationRoot $InstallationRoot -ScriptRoot $PSScriptRoot
    $configDir = Resolve-DispatcherLocalPath -Path (Join-Path $root 'config') -Label 'Папка конфигурации'
    $configPath = Join-Path $configDir 'server.json'
    $previous = Read-DispatcherConfig -Path $configPath
    $config = [ordered]@{}
    foreach ($name in @('dataDir', 'usersFile', 'stateDir', 'port', 'backupDir')) {
        if ($previous.ContainsKey($name)) { $config[$name] = $previous[$name] }
    }
    if ($DataDir) { $config.dataDir = $DataDir }
    if ($UsersFile) { $config.usersFile = $UsersFile }
    if ($StateDir) { $config.stateDir = $StateDir }
    if ($BackupDir) { $config.backupDir = $BackupDir }
    if (-not $config.Contains('usersFile')) { $config.usersFile = Join-Path $configDir 'users.json' }
    if (-not $config.Contains('stateDir')) { $config.stateDir = Join-Path $root 'state' }
    if ($PSBoundParameters.ContainsKey('Port') -or -not $config.Contains('port')) { $config.port = $Port }
    if (-not $config.Contains('dataDir') -or -not $config.dataDir) { throw 'При первой настройке укажите -DataDir с существующей базой SQLite.' }
    $config.dataDir = Resolve-DispatcherLocalPath -Path $config.dataDir -Label 'Рабочая база' -MustExist -Directory
    $config.usersFile = Resolve-DispatcherLocalPath -Path $config.usersFile -Label 'Персональные учётные записи' -MustExist
    $config.stateDir = Resolve-DispatcherLocalPath -Path $config.stateDir -Label 'Состояние очереди'
    if ($config.Contains('backupDir')) { $config.backupDir = Resolve-DispatcherLocalPath -Path $config.backupDir -Label 'Резервные копии' }
    if ((Test-DispatcherInside -Parent $config.stateDir -Target $configDir) -or (Test-DispatcherInside -Parent $configDir -Target $config.stateDir)) { throw 'Папки конфигурации и очереди операций должны храниться отдельно.' }
    $config.host = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
    $config.allowedHosts = @(Get-DispatcherTrustedHosts -Lan:$Lan -TrustedHost $TrustedHost)
    if (-not (Test-Path -LiteralPath $configDir)) { $null = [System.IO.Directory]::CreateDirectory($configDir) }
    $candidatePath = Join-Path $configDir ('.server.' + [guid]::NewGuid().ToString('N') + '.pending.json')
    $json = $config | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($candidatePath, $json, (New-Object System.Text.UTF8Encoding($false)))
    $nodePath = Join-Path $root 'runtime\node.exe'
    $checkerPath = Join-Path $root 'app\web\deployment\windows\check-configuration.cjs'
    & $nodePath $checkerPath --config $candidatePath --backup
    if ($LASTEXITCODE -ne 0) { throw 'Проверка базы, персональных учётных записей или резервного пакета не пройдена. Прежняя конфигурация сохранена.' }
    if (Test-Path -LiteralPath $configPath) {
        $configBackup = Join-Path $configDir ('server.' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '.' + [guid]::NewGuid().ToString('N') + '.previous.json')
        [System.IO.File]::Replace($candidatePath, $configPath, $configBackup)
    } else { [System.IO.File]::Move($candidatePath, $configPath) }
    $candidatePath = $null
    Write-Host ('Конфигурация сохранена: {0}' -f $configPath)
    Write-Host 'Резервный пакет рабочей базы проверен. Сервер ещё не запускался.'
    Write-DispatcherAddresses -Config $config
    Write-Host ('Запуск: & "{0}"' -f (Join-Path $PSScriptRoot 'Start-Dispatcher.ps1'))
} catch {
    Write-Error $_.Exception.Message -ErrorAction Continue
    exit 1
} finally {
    if ($candidatePath -and (Test-Path -LiteralPath $candidatePath)) { Remove-Item -LiteralPath $candidatePath -Force }
}
