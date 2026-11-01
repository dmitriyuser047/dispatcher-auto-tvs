Set-StrictMode -Version Latest

function Resolve-DispatcherLocalPath {
    param([Parameter(Mandatory = $true)][string]$Path, [string]$Label = 'Путь', [switch]$MustExist, [switch]$Directory)
    if ($Path -notmatch '^[A-Za-z]:[\\/]' -or $Path -match '^[\\/]{2}') { throw "$Label`: нужен абсолютный путь на локальном диске Windows." }
    $resolved = [System.IO.Path]::GetFullPath($Path)
    $ancestor = $resolved
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "$Label`: ссылки и junction не допускаются." }
        }
        $next = [System.IO.Path]::GetDirectoryName($ancestor)
        if ($next -eq $ancestor) { break }
        $ancestor = $next
    }
    if ($MustExist) {
        if (-not (Test-Path -LiteralPath $resolved)) { throw "$Label`: путь не найден." }
        $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
        if ($Directory -and -not $item.PSIsContainer) { throw "$Label`: нужен каталог." }
        if (-not $Directory -and $item.PSIsContainer) { throw "$Label`: нужен файл." }
    }
    return $resolved
}

function Get-DispatcherInstallationRoot {
    param([string]$InstallationRoot, [Parameter(Mandatory = $true)][string]$ScriptRoot)
    if (-not $InstallationRoot) { $InstallationRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot '..\..\..\..')) }
    $root = Resolve-DispatcherLocalPath -Path $InstallationRoot -Label 'Папка программы' -MustExist -Directory
    foreach ($relative in @('runtime\node.exe', 'app\web\local-runtime.cjs', 'app\web\launch-local.cjs', 'app\web\deployment\windows\check-configuration.cjs')) {
        $null = Resolve-DispatcherLocalPath -Path (Join-Path $root $relative) -Label "Файл программы $relative" -MustExist
    }
    return $root
}

function Read-DispatcherConfig {
    param([Parameter(Mandatory = $true)][string]$Path)
    $result = @{}
    if (Test-Path -LiteralPath $Path) {
        $null = Resolve-DispatcherLocalPath -Path $Path -Label 'Конфигурация' -MustExist
        $source = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json -ErrorAction Stop
        if ($source -isnot [System.Management.Automation.PSCustomObject]) { throw 'Конфигурация должна быть JSON-объектом.' }
        foreach ($property in $source.PSObject.Properties) { $result[$property.Name] = $property.Value }
    }
    return $result
}

function Test-DispatcherInside {
    param([Parameter(Mandatory = $true)][string]$Parent, [Parameter(Mandatory = $true)][string]$Target)
    $prefix = $Parent.TrimEnd('\', '/')
    return $Target.Equals($prefix, [System.StringComparison]::OrdinalIgnoreCase) -or $Target.StartsWith($prefix + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-DispatcherPrivateIPv4 {
    param([Parameter(Mandatory = $true)][string]$Value)
    $address = $null
    if (-not [System.Net.IPAddress]::TryParse($Value, [ref]$address) -or $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    if ($address.ToString() -ne $Value) { return $false }
    $bytes = $address.GetAddressBytes()
    return $bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}

function Get-DispatcherTrustedHosts {
    param([switch]$Lan, [string[]]$TrustedHost = @())
    if (-not $Lan -and $TrustedHost.Count -gt 0) { throw '-TrustedHost применяется только вместе с -Lan.' }
    $hosts = @('127.0.0.1', 'localhost')
    if ($Lan) {
        if ($TrustedHost.Count -gt 0) {
            foreach ($candidate in $TrustedHost) {
                if ($candidate -notmatch '^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$' -or $candidate -match '\.\.|^[0-9.]+$' -and -not (Test-DispatcherPrivateIPv4 $candidate)) { throw 'TrustedHost: укажите имя компьютера или частный IPv4 без протокола, пути и порта.' }
                $hosts += $candidate.ToLowerInvariant()
            }
        } else {
            $privateAddresses = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.OperationalStatus -eq [System.Net.NetworkInformation.OperationalStatus]::Up } | ForEach-Object { $_.GetIPProperties().UnicastAddresses } | ForEach-Object { $_.Address.ToString() } | Where-Object { Test-DispatcherPrivateIPv4 $_ })
            if ($privateAddresses.Count -eq 0) { throw 'Частный IPv4 не найден. Подключитесь к локальной сети или укажите -TrustedHost явно.' }
            $hosts += [System.Net.Dns]::GetHostName().ToLowerInvariant()
            $hosts += $privateAddresses
        }
    }
    return @($hosts | Select-Object -Unique)
}

function Write-DispatcherAddresses {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Config)
    Write-Host ('На сервере: http://127.0.0.1:{0}/objects' -f $Config.port)
    if ($Config.Contains('host') -and $Config.host -eq '0.0.0.0') {
        Write-Host 'Для сотрудников в локальной сети:'
        foreach ($hostname in @($Config.allowedHosts)) {
            if ($hostname -notin @('127.0.0.1', 'localhost', '::1')) { Write-Host ('  http://{0}:{1}/objects' -f $hostname, $Config.port) }
        }
        Write-Host 'Доступ рассчитан на доверенную локальную сеть. Каждый сотрудник входит со своим ключом.'
    }
}

Export-ModuleMember -Function Resolve-DispatcherLocalPath, Get-DispatcherInstallationRoot, Read-DispatcherConfig, Test-DispatcherInside, Get-DispatcherTrustedHosts, Write-DispatcherAddresses
