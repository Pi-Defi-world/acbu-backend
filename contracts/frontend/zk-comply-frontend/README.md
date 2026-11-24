# ZK-Comply Frontend (AZ-009)

Browser UI that:

1. Loads the Noir KYC-compliance circuit
2. Generates a real UltraHonk ZK proof via `generateProof`
3. Submits `zk_verifier.verify(wallet, nullifier, commitment)` via `submitProof`

## Dev

```bash
cd frontend/zk-comply-frontend
npm install
npm run dev
```

Optional env:

- `VITE_VERIFIER_CONTRACT_ID` — deployed `zk_verifier` contract id
- `VITE_ACBU_API_URL` — ACBU backend base URL
