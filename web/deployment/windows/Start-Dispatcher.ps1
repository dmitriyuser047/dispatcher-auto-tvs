#requires -Version 5.1
[CmdletBinding()]
param([string]$InstallationRoot = '', [switch]$NoOpen)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Dispatcher.Windows.psm1') -Force
try {
    $root = Get-DispatcherInstallationRoot -InstallationRoot $InstallationRoot -ScriptRoot $PSScriptRoot
    $configPath = Resolve-DispatcherLocalPath -Path (Join-Path $root 'config\server.json') -Label 'Конфигурация' -MustExist
    $nodePath = Join-Path $root 'runtime\node.exe'
    $launcherPath = Join-Path $root 'app\web\launch-local.cjs'
    $arguments = @($launcherPath, '--config', $configPath)
    if ($NoOpen) { $arguments += '--no-open' }
    & $nodePath @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Запуск не подтверждён. Проверьте сообщение выше и журналы в config\launch.' }
    $config = Read-DispatcherConfig -Path $configPath
    Write-DispatcherAddresses -Config $config
    Write-Host ('Журналы запуска: {0}' -f (Join-Path $root 'config\launch'))
} catch {
    Write-Error $_.Exception.Message -ErrorAction Continue
    exit 1
}
