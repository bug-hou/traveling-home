/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_TENCENT_MAP_KEY: string;
  readonly VITE_ENABLE_PWA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
