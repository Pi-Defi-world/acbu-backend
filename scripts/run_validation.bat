@echo off
REM B-013: Validate Stellar Addresses
REM This script runs the validation SQL against your database

echo ============================================
echo B-013: Stellar Address Validation
echo ============================================
echo.

REM Check if psql is available
where psql >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: psql not found in PATH
    echo Please install PostgreSQL client or add it to PATH
    echo.
    echo Alternative: Use Prisma Studio or pgAdmin
    echo SQL file location: scripts\validate_stellar_addresses.sql
    pause
    exit /b 1
)

REM Read DATABASE_URL from .env or .env.example
set ENV_FILE=.env
if not exist .env set ENV_FILE=.env.example

echo Reading database configuration from %ENV_FILE%...
echo.

REM Extract database connection details
for /f "tokens=*" %%a in ('findstr /r "^DATABASE_URL=" %ENV_FILE%') do (
    set DATABASE_URL=%%a
)

if not defined DATABASE_URL (
    echo ERROR: DATABASE_URL not found in %ENV_FILE%
    pause
    exit /b 1
)

REM Parse DATABASE_URL (format: postgresql://user:pass@host:port/db)
set DATABASE_URL=%DATABASE_URL:DATABASE_URL=%
set DATABASE_URL=%DATABASE_URL:"=%
set DATABASE_URL=%DATABASE_URL:postgresql://=%

for /f "tokens=1,2,3,4 delims=/:@" %%a in ("%DATABASE_URL%") do (
    set DB_USER=%%a
    set DB_PASS=%%b
    set DB_HOST=%%c
    set DB_PORT=%%d
    set DB_NAME=%%e
)

echo Connecting to database...
echo Host: %DB_HOST%
echo Port: %DB_PORT%
echo Database: %DB_NAME%
echo User: %DB_USER%
echo.
echo ============================================
echo Running validation...
echo ============================================
echo.

REM Set password for psql
set PGPASSWORD=%DB_PASS%

REM Run validation script
psql -U %DB_USER% -h %DB_HOST% -p %DB_PORT% -d %DB_NAME% -f scripts\validate_stellar_addresses.sql

echo.
echo ============================================
echo Validation Complete
echo ============================================
echo.
echo Next steps:
echo - If invalid_address_count = 0: Safe to deploy migration
echo - If invalid addresses found: Fix them before deploying
echo.

pause
