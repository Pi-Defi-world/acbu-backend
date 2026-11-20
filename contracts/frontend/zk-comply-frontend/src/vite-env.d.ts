/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VERIFIER_CONTRACT_ID?: string;
  readonly VITE_ACBU_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
