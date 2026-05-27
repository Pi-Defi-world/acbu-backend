Param()

# Run tests locally with Docker Compose for required services (Postgres, Mongo).
# Usage: Open PowerShell as Administrator and run: .\scripts\run-tests-local.ps1

function FailIf($msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    FailIf "docker CLI not found. Install Docker Desktop and ensure it's running."
}

Write-Host "Starting Docker Compose services..."
try {
    docker compose up -d | Out-Null
} catch {
    docker-compose up -d | Out-Null
}

Write-Host "Waiting for Postgres to be ready..."
$max = 120
$i = 0
while ($i -lt $max) {
    try {
        docker exec acbu-postgres pg_isready -U ${env:POSTGRES_USER -or 'acbu'} > $null 2>&1
        if ($LASTEXITCODE -eq 0) { break }
    } catch { }
    Start-Sleep -Seconds 1
    $i++
}
if ($i -ge $max) { FailIf "Postgres did not become ready in time." }

Write-Host "Ensuring test database exists (acbu_test)..."
$exists = docker exec -i acbu-postgres psql -U ${env:POSTGRES_USER -or 'acbu'} -tAc "SELECT 1 FROM pg_database WHERE datname='acbu_test'" 2>$null
if (-not $exists) {
    docker exec -i acbu-postgres psql -U ${env:POSTGRES_USER -or 'acbu'} -c "CREATE DATABASE acbu_test;" || FailIf "Failed to create acbu_test database."
    Write-Host "Created acbu_test database."
} else {
    Write-Host "acbu_test database already exists."
}

Write-Host "Pushing Prisma schema and generating client..."
pnpm prisma:push || FailIf "pnpm prisma:push failed"
pnpm prisma:generate || FailIf "pnpm prisma:generate failed"

Write-Host "Running tests (Jest)..."
pnpm test -i --runInBand

$exitCode = $LASTEXITCODE
if ($exitCode -eq 0) { Write-Host "Tests completed successfully." -ForegroundColor Green } else { Write-Host "Tests exited with code $exitCode" -ForegroundColor Yellow }
exit $exitCode
