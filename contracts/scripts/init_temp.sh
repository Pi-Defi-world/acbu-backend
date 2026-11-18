#!/bin/bash
set -e

# Configuration
NETWORK="testnet"
SECRET="SA2P2MWG4L4KMKYXNVSS73NTZWKRYDPJDXLVODDSYCPWQ5LVIZNXIBAR"
ADMIN="GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDML"

# Contract IDs
ORACLE="CCJ6L5CVLRSLYVYWMEFSC3QZ5OHAB2DEVFV6GUWCAMF4NZIO7CYE66OQ"
MINTING="CDMP4TQHVYBO2QVGLRBGFJWDCUVYW6N6W4QKBPJBUQAMSPMBH53ATTSP"
BURNING="CD5WQGBEX3HUH7INUXK4LVMVTK7OIPAQZHJDIRKZNINXNWTBSFSYU2N3"
ESCROW="CDMOYTXKPH342MZ5W4A4XZFCV3Q5H52AMVQR4OSF3J76JCLPBRWXQD4H"
RESERVE_TRACKER="CAXWKQCLIKG5TFYYJCWDVTW7B4LXYBRCXDWYLKCIILMG2BTZK6YQ3DMH"
ACBU_TOKEN="CB2RDXQAIQT5XG3XTRHKAGLMV24TPLCOKBFXVELF2PJS4K42UYXZT6KI"
USDC_TOKEN="CCW67Z7YIEXZFYUCP66X37O6E6U74N54JDXC2KUC5365S3XYR7O5L6YI"

echo "--- Starting Initialization via Bash ---"

# 1. Initialize Oracle
echo "Initializing Oracle..."
stellar contract invoke \
  --id "$ORACLE" \
  --network "$NETWORK" \
  --source "$SECRET" \
  -- initialize \
  --admin "$ADMIN" \
  --validators "[\"$ADMIN\"]" \
  --min_signatures 1 \
  --currencies '["NGN", "ZAR", "KES", "EGP", "GHS", "RWF", "XOF", "MAD", "TZS", "UGX"]' \
  --basket_weights '{"NGN": 18, "ZAR": 15, "KES": 12, "EGP": 11, "GHS": 9, "RWF": 8, "XOF": 8, "MAD": 7, "TZS": 6, "UGX": 6}'

# 2. Initialize Minting
echo "Initializing Minting..."
stellar contract invoke \
  --id "$MINTING" \
  --network "$NETWORK" \
  --source "$SECRET" \
  -- initialize \
  --admin "$ADMIN" \
  --oracle "$ORACLE" \
  --reserve_tracker "$RESERVE_TRACKER" \
  --acbu_token "$ACBU_TOKEN" \
  --usdc_token "$USDC_TOKEN" \
  --vault "$ADMIN" \
  --treasury "$ADMIN" \
  --fee_rate_bps 30 \
  --fee_single_bps 50

# 3. Initialize Burning (in case it failed previously)
echo "Initializing Burning..."
stellar contract invoke \
  --id "$BURNING" \
  --network "$NETWORK" \
  --source "$SECRET" \
  -- initialize \
  --admin "$ADMIN" \
  --oracle "$ORACLE" \
  --reserve_tracker "$RESERVE_TRACKER" \
  --acbu_token "$ACBU_TOKEN" \
  --withdrawal_processor "$ADMIN" \
  --vault "$ADMIN" \
  --fee_rate_bps 30 \
  --fee_single_redeem_bps 100

# 4. Initialize Escrow (in case it failed previously)
echo "Initializing Escrow..."
stellar contract invoke \
  --id "$ESCROW" \
  --network "$NETWORK" \
  --source "$SECRET" \
  -- initialize \
  --admin "$ADMIN" \
  --acbu_token "$ACBU_TOKEN"

echo "--- Initialization complete ---"
