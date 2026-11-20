@echo off
rem AX-002: Never hardcode signing keys. Set STELLAR_SECRET_KEY in your
rem environment (or CI secrets) before running this script:
rem
rem   set STELLAR_SECRET_KEY=S…your-testnet-key…
rem
rem Rotate any key that was previously committed to git history (git filter-repo).
if not defined STELLAR_SECRET_KEY (
    echo ERROR: STELLAR_SECRET_KEY is not set. AX-002: do not hardcode keys in scripts.
    exit /b 1
)
set STELLAR_NETWORK=testnet
set ADMIN=GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDML
set ORACLE=CCJ6L5CVLRSLYVYWMEFSC3QZ5OHAB2DEVFV6GUWCAMF4NZIO7CYE66OQ

echo Initializing Oracle...

stellar contract invoke ^
  --id %ORACLE% ^
  --network %STELLAR_NETWORK% ^
  --source %STELLAR_SECRET_KEY% ^
  -- ^
  initialize ^
  --admin %ADMIN% ^
  --validators-file-path .\validators.json ^
  --min_signatures 1 ^
  --currencies-file-path .\currencies.json ^
  --basket_weights-file-path .\weights.json

echo Oracle initialization complete.
