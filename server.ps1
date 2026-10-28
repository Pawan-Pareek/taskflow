# TaskFlow Pro — Zero-Dependency Native Cross-Device Server
# Serves static web app files and provides authenticated REST API for sync between Mobile and Laptop
$ErrorActionPreference = "Continue"

$Port = 8080
$RootDir = $PSScriptRoot
$DataDir = Join-Path $RootDir "data"
$DbFile = Join-Path $DataDir "database.json"

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# Initialize database if not exists
if (-not (Test-Path $DbFile)) {
    $initialDb = @{
        users = @(
            @{
                id = "usr_demo_1"
                username = "alex"
                name = "Alex Rivera"
                email = "alex@example.com"
                passwordHash = "demo1234"
                avatar = "avatar-1"
                createdAt = (Get-Date).ToString("o")
            }
        )
        todos = @{
            "usr_demo_1" = @(
                @{
                    id = "task_init_1"
                    title = "Welcome to TaskFlow Pro!"
                    notes = "Your todo list is live and ready to sync between your laptop and your mobile phone."
                    priority = "urgent"
                    category = "personal"
                    dueDate = (Get-Date).ToString("yyyy-MM-dd")
                    completed = $false
                    starred = $true
                    subtasks = @(
                        @{ id = "st_1"; title = "Open on mobile using QR Code"; completed = $false },
                        @{ id = "st_2"; title = "Test task creation"; completed = $true }
                    )
                    createdAt = (Get-Date).ToString("o")
                },
                @{
                    id = "task_init_2"
                    title = "Scan QR Code on your mobile phone"
                    notes = "Click Connect Phone on your laptop to view the QR code and link."
                    priority = "high"
                    category = "work"
                    dueDate = (Get-Date).ToString("yyyy-MM-dd")
                    completed = $false
                    starred = $true
                    subtasks = @()
                    createdAt = (Get-Date).ToString("o")
                }
            )
        }
    }
    $initialDb | ConvertTo-Json -Depth 10 | Set-Content $DbFile -Encoding UTF8
}

# Function to get Local Area Network (LAN) IP
function Get-LocalIP {
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi*", "Ethernet*" -ErrorAction SilentlyContinue | 
               Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | 
               Select-Object -First 1).IPAddress
        if ($ip) { return $ip }
    } catch {}

    try {
        $hostName = [System.Net.Dns]::GetHostName()
        $ips = [System.Net.Dns]::GetHostAddresses($hostName) | Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike "127.*" }
        if ($ips) { return $ips[0].IPAddressToString }
    } catch {}

    return "127.0.0.1"
}

$LanIP = Get-LocalIP
$LocalUrl = "http://localhost:$Port"
$MobileUrl = "http://" + $LanIP + ":" + $Port

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   TaskFlow Pro -- Cross-Device Server is RUNNING!" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   Laptop Access: " -NoNewline -ForegroundColor White
Write-Host "$LocalUrl" -ForegroundColor Yellow
Write-Host "   Mobile Access: " -NoNewline -ForegroundColor White
Write-Host "$MobileUrl" -ForegroundColor Yellow
Write-Host "   (Scan the QR Code inside the app with your phone camera!)" -ForegroundColor Gray
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor DarkGray
Write-Host ""

# Start TCP Listener on all network interfaces
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
$listener.Start()

function Send-HttpResponse {
    param(
        $Stream,
        [int]$StatusCode = 200,
        [string]$StatusText = "OK",
        [string]$ContentType = "text/plain; charset=utf-8",
        [byte[]]$BodyBytes = @()
    )
    $headerStr = "HTTP/1.1 $StatusCode $StatusText`r`n" +
                 "Content-Type: $ContentType`r`n" +
                 "Content-Length: $($BodyBytes.Length)`r`n" +
                 "Access-Control-Allow-Origin: *`r`n" +
                 "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`r`n" +
                 "Access-Control-Allow-Headers: Content-Type, Authorization`r`n" +
                 "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($headerStr)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($BodyBytes.Length -gt 0) {
        $Stream.Write($BodyBytes, 0, $BodyBytes.Length)
    }
}

function Get-Db {
    $raw = Get-Content $DbFile -Raw -Encoding UTF8
    return $raw | ConvertFrom-Json
}

function Save-Db ($dbObj) {
    $dbObj | ConvertTo-Json -Depth 10 | Set-Content $DbFile -Encoding UTF8
}

while ($true) {
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)

        # Read Request Line
        $requestLine = $reader.ReadLine()
        if (-not $requestLine) {
            $client.Close()
            continue
        }

        $parts = $requestLine -split ' '
        $method = $parts[0]
        $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
        $urlPath = ($rawPath -split '\?')[0]

        # Read Headers
        $headers = @{}
        $contentLength = 0
        while ($line = $reader.ReadLine()) {
            if ($line.Trim() -eq "") { break }
            $hParts = $line -split ':', 2
            if ($hParts.Length -ge 2) {
                $key = $hParts[0].Trim().ToLower()
                $val = $hParts[1].Trim()
                $headers[$key] = $val
                if ($key -eq "content-length") {
                    [int]::TryParse($val, [ref]$contentLength) | Out-Null
                }
            }
        }

        # Read Body if present
        $body = ""
        if ($contentLength -gt 0) {
            $buffer = New-Object char[] $contentLength
            $readTotal = 0
            while ($readTotal -lt $contentLength) {
                $count = $reader.Read($buffer, $readTotal, $contentLength - $readTotal)
                if ($count -le 0) { break }
                $readTotal += $count
            }
            $body = New-Object string ($buffer, 0, $readTotal)
        }

        # CORS Preflight
        if ($method -eq "OPTIONS") {
            Send-HttpResponse -Stream $stream -StatusCode 200 -StatusText "OK" -BodyBytes @()
            $client.Close()
            continue
        }

        # ----------------- API ENDPOINTS -----------------
        if ($urlPath -eq "/api/info") {
            $info = @{
                status = "online"
                mode = "lan-server"
                lanUrl = $MobileUrl
                hostUrl = $LocalUrl
                ip = $LanIP
                port = $Port
            }
            $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes(($info | ConvertTo-Json))
            Send-HttpResponse -Stream $stream -ContentType "application/json" -BodyBytes $jsonBytes
            $client.Close()
            continue
        }

        if ($urlPath -eq "/api/auth/register" -and $method -eq "POST") {
            try {
                $userData = $body | ConvertFrom-Json
                $db = Get-Db
                $uName = $userData.username.ToString().Trim().ToLower()
                $existing = $db.users | Where-Object { $_.username.ToLower() -eq $uName }
                if ($existing) {
                    $err = @{ error = "Username is already taken." } | ConvertTo-Json
                    Send-HttpResponse -Stream $stream -StatusCode 400 -StatusText "Bad Request" -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($err))
                } else {
                    $newId = "usr_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    $newUser = @{
                        id = $newId
                        username = $userData.username
                        name = if ($userData.name) { $userData.name } else { $userData.username }
                        email = $userData.email
                        passwordHash = $userData.password
                        avatar = if ($userData.avatar) { $userData.avatar } else { "avatar-1" }
                        createdAt = (Get-Date).ToString("o")
                    }
                    $db.users += $newUser

                    # Initialize welcome todos for new user
                    if (-not $db.todos) { $db.todos = @{} }
                    $db.todos | Add-Member -NotePropertyName $newId -NotePropertyValue @(
                        @{
                            id = "task_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                            title = "Welcome, " + $newUser.name + "!"
                            notes = "This task was synced from your TaskFlow server."
                            priority = "high"
                            category = "personal"
                            dueDate = (Get-Date).ToString("yyyy-MM-dd")
                            completed = $false
                            starred = $true
                            subtasks = @()
                            createdAt = (Get-Date).ToString("o")
                        }
                    ) -Force

                    Save-Db $db
                    $token = "tok_" + $newId + "_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    $res = @{
                        user = @{
                            id = $newUser.id
                            username = $newUser.username
                            name = $newUser.name
                            email = $newUser.email
                            avatar = $newUser.avatar
                        }
                        token = $token
                    } | ConvertTo-Json
                    Send-HttpResponse -Stream $stream -StatusCode 200 -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($res))
                }
            } catch {
                $err = @{ error = "Failed to process registration." } | ConvertTo-Json
                Send-HttpResponse -Stream $stream -StatusCode 500 -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($err))
            }
            $client.Close()
            continue
        }

        if ($urlPath -eq "/api/auth/login" -and $method -eq "POST") {
            try {
                $creds = $body | ConvertFrom-Json
                $idInput = $creds.identifier.ToString().Trim().ToLower()
                $pwdInput = $creds.password.ToString()

                $db = Get-Db
                $matched = $db.users | Where-Object { 
                    ($_.username.ToLower() -eq $idInput -or $_.email.ToLower() -eq $idInput) -and 
                    ($_.passwordHash -eq $pwdInput -or $_.passwordHash -eq ("h_" + $pwdInput))
                }

                if ($matched) {
                    $userObj = $matched[0]
                    $token = "tok_" + $userObj.id + "_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    $res = @{
                        user = @{
                            id = $userObj.id
                            username = $userObj.username
                            name = $userObj.name
                            email = $userObj.email
                            avatar = $userObj.avatar
                        }
                        token = $token
                    } | ConvertTo-Json
                    Send-HttpResponse -Stream $stream -StatusCode 200 -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($res))
                } else {
                    $err = @{ error = "Invalid username/email or password." } | ConvertTo-Json
                    Send-HttpResponse -Stream $stream -StatusCode 401 -StatusText "Unauthorized" -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($err))
                }
            } catch {
                $err = @{ error = "Login error." } | ConvertTo-Json
                Send-HttpResponse -Stream $stream -StatusCode 500 -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($err))
            }
            $client.Close()
            continue
        }

        if ($urlPath -eq "/api/todos") {
            # Extract user from token
            $authHeader = $headers["authorization"]
            $userId = "usr_demo_1"
            if ($authHeader -and $authHeader -match 'tok_([a-zA-Z0-9_]+)_') {
                $userId = $matches[1]
            }

            $db = Get-Db
            $userTodos = if ($db.todos.$userId) { $db.todos.$userId } else { @() }
            if (-not $userTodos -or ($userTodos | Measure-Object).Count -eq 0) {
                $res = "[]"
            } else {
                $json = ($userTodos | ConvertTo-Json -Depth 10).Trim()
                if ($json.StartsWith("[")) {
                    $res = $json
                } else {
                    $res = "[$json]"
                }
            }
            Send-HttpResponse -Stream $stream -StatusCode 200 -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($res))
            $client.Close()
            continue
        }

        if ($urlPath -eq "/api/todos/batch" -and $method -eq "POST") {
            $authHeader = $headers["authorization"]
            $userId = "usr_demo_1"
            if ($authHeader -and $authHeader -match 'tok_([a-zA-Z0-9_]+)_') {
                $userId = $matches[1]
            }

            try {
                $batchData = $body | ConvertFrom-Json
                $db = Get-Db
                if (-not $db.todos) { $db | Add-Member -NotePropertyName 'todos' -NotePropertyValue (New-Object PSObject) -Force }
                $todosList = @($batchData.todos)
                $db.todos | Add-Member -NotePropertyName $userId -NotePropertyValue $todosList -Force
                Save-Db $db
                $res = @{ status = "synced" } | ConvertTo-Json
                Send-HttpResponse -Stream $stream -StatusCode 200 -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($res))
            } catch {
                $err = @{ error = "Failed to sync todos." } | ConvertTo-Json
                Send-HttpResponse -Stream $stream -StatusCode 500 -ContentType "application/json" -BodyBytes ([System.Text.Encoding]::UTF8.GetBytes($err))
            }
            $client.Close()
            continue
        }

        # ----------------- STATIC FILES -----------------
        $relPath = if ($urlPath -eq "/" -or $urlPath -eq "") { "index.html" } else { $urlPath.TrimStart('/') }
        $filePath = Join-Path $RootDir $relPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mimeType = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".png"  { "image/png" }
                ".jpg"  { "image/jpeg" }
                ".jpeg" { "image/jpeg" }
                ".svg"  { "image/svg+xml" }
                ".ico"  { "image/x-icon" }
                default { "application/octet-stream" }
            }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            Send-HttpResponse -Stream $stream -StatusCode 200 -StatusText "OK" -ContentType $mimeType -BodyBytes $bytes
        } else {
            $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            Send-HttpResponse -Stream $stream -StatusCode 404 -StatusText "Not Found" -BodyBytes $notFound
        }

        $client.Close()
    } catch {
        # Silent loop resilience
    }
}
