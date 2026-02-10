/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NFA_ADDRESS?: string;
  readonly VITE_FARM_ADDRESS?: string;
  readonly VITE_TOKEN_ADDRESS?: string;
  readonly VITE_BSC_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
