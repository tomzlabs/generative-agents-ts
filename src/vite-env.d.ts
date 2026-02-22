/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NFA_ADDRESS?: string;
  readonly VITE_FARM_ADDRESS?: string;
  readonly VITE_TOKEN_ADDRESS?: string;
  readonly VITE_BSC_RPC_URL?: string;
  readonly VITE_CONWAY_PROXY_BASE?: string;
  readonly VITE_CONWAY_API_BASE?: string;
  readonly VITE_CONWAY_API_KEY?: string;
  readonly VITE_CONWAY_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
