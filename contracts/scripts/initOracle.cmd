@echo off
set STELLAR_NETWORK=testnet
set STELLAR_SECRET_KEY=SA2P2MWG4L4KMKYXNVSS73NTZWKRYDPJDXLVODDSYCPWQ5LVIZNXIBAR
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
