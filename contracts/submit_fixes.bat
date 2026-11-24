@echo off
:: =============================================================================
:: submit_fixes.bat  —  ACBU smart contract fixes (#355, #357, #361, #362)
:: Usage: Double-click or run from a command prompt.
:: Run this from the ROOT of your local acbu-smart-contract clone.
:: =============================================================================

setlocal enabledelayedexpansion

:: ── Config ────────────────────────────────────────────────────────────────────
set BRANCH=fix/issues-355-357-361-362
set REMOTE=origin
set BASE_BRANCH=dev
:: Change BASE_BRANCH to "main" above if your repo uses main

:: ── Helpers ───────────────────────────────────────────────────────────────────
:: FIXES_DIR is relative to this script; adjust if you placed acbu-fixes elsewhere
set FIXES_DIR=%~dp0acbu-fixes

:: ── Pre-flight ────────────────────────────────────────────────────────────────
echo [INFO] Checking prerequisites...

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] git not found. Install Git for Windows: https://git-scm.com/
    pause & exit /b 1
)

if not exist "Cargo.toml" (
    echo [ERROR] Cargo.toml not found.
    echo         Run this script from the root of the acbu-smart-contract repo.
    pause & exit /b 1
)

:: Check for uncommitted changes
git diff --quiet
if errorlevel 1 (
    echo [ERROR] Working tree has uncommitted changes.
    echo         Stash or commit them before running this script.
    pause & exit /b 1
)
git diff --cached --quiet
if errorlevel 1 (
    echo [ERROR] Staged changes detected.
    echo         Commit or reset them before running this script.
    pause & exit /b 1
)

:: ── Fetch & branch ────────────────────────────────────────────────────────────
echo [INFO] Fetching latest '%BASE_BRANCH%' from %REMOTE%...
git fetch %REMOTE% %BASE_BRANCH%
if errorlevel 1 ( echo [ERROR] git fetch failed & pause & exit /b 1 )

:: Check if branch already exists locally
git show-ref --quiet "refs/heads/%BRANCH%"
if errorlevel 1 (
    echo [INFO] Creating branch '%BRANCH%' from %REMOTE%/%BASE_BRANCH%...
    git checkout -b %BRANCH% %REMOTE%/%BASE_BRANCH%
) else (
    echo [WARN] Branch '%BRANCH%' already exists — checking it out
    git checkout %BRANCH%
)
if errorlevel 1 ( echo [ERROR] git checkout failed & pause & exit /b 1 )

:: ── Copy fixed files ──────────────────────────────────────────────────────────
echo [INFO] Copying fixed source files...

:: acbu_escrow
if exist "%FIXES_DIR%\acbu_escrow\src\lib.rs" (
    if not exist "acbu_escrow\src" mkdir "acbu_escrow\src"
    copy /Y "%FIXES_DIR%\acbu_escrow\src\lib.rs" "acbu_escrow\src\lib.rs" >nul
    echo [INFO] Copied: acbu_escrow\src\lib.rs
) else (
    echo [WARN] Not found, skipping: %FIXES_DIR%\acbu_escrow\src\lib.rs
)

:: acbu_minting
if exist "%FIXES_DIR%\acbu_minting\src\lib.rs" (
    if not exist "acbu_minting\src" mkdir "acbu_minting\src"
    copy /Y "%FIXES_DIR%\acbu_minting\src\lib.rs" "acbu_minting\src\lib.rs" >nul
    echo [INFO] Copied: acbu_minting\src\lib.rs
) else (
    echo [WARN] Not found, skipping: %FIXES_DIR%\acbu_minting\src\lib.rs
)

:: shared errors
if exist "%FIXES_DIR%\shared\src\errors.rs" (
    if not exist "shared\src" mkdir "shared\src"
    copy /Y "%FIXES_DIR%\shared\src\errors.rs" "shared\src\errors.rs" >nul
    echo [INFO] Copied: shared\src\errors.rs
) else (
    echo [WARN] Not found, skipping: %FIXES_DIR%\shared\src\errors.rs
)

:: ── Stage ─────────────────────────────────────────────────────────────────────
echo [INFO] Staging changes...
git add acbu_escrow\src\lib.rs acbu_minting\src\lib.rs shared\src\errors.rs
if errorlevel 1 ( echo [ERROR] git add failed & pause & exit /b 1 )

:: Check if there is anything to commit
git diff --cached --quiet
if not errorlevel 1 (
    echo [WARN] Nothing new to commit — files may already be up to date
    goto :push
)

:: ── Commit ────────────────────────────────────────────────────────────────────
echo [INFO] Committing...
git commit -m "fix: address issues #355 #357 #361 #362" -m "#357 — add AlreadyInitialized guard to initialize() in escrow & minting. Prevents re-initialisation from silently overwriting admin, fee rate, and token addresses." -m "#361 — add #[allow(dead_code)] to emit-only event structs. Suppresses spurious lint warnings so real dead-code issues are not masked." -m "#355 — differentiate token_client transfer errors. Switch from transfer() (panics) to try_transfer() (Result). TokenXferFailed for token-side rejections, TransferFailed for internal disbursements." -m "#362 — deduplicate require_auth when user == admin. New require_auth_dedup() helper skips the second auth charge when both addresses are identical."
if errorlevel 1 ( echo [ERROR] git commit failed & pause & exit /b 1 )

:push
:: ── Push ──────────────────────────────────────────────────────────────────────
echo [INFO] Pushing branch to %REMOTE%...
git push -u %REMOTE% %BRANCH%
if errorlevel 1 ( echo [ERROR] git push failed & pause & exit /b 1 )

:: ── Done ──────────────────────────────────────────────────────────────────────
echo.
echo [OK] Branch pushed successfully.
echo.
echo  Next steps:
echo  1. Open a PR on GitHub:
echo     https://github.com/Pi-Defi-world/acbu-smart-contract/compare/%BASE_BRANCH%...%BRANCH%
echo.
echo  2. Or, if you have the GitHub CLI installed:
echo     gh pr create --base %BASE_BRANCH% --head %BRANCH% ^
echo       --title "fix: address issues #355 #357 #361 #362" ^
echo       --body-file acbu-fixes\FIX_SUMMARY.md
echo.
pause
