// 统一从这里读取环境变量，业务代码不要直接使用 import.meta.env
export const env = {
  // Local dev uses the Vite proxy; deployed builds default to the API subdomain.
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '' : 'https://api.convenience.top'),
  tencentMapKey: import.meta.env.VITE_TENCENT_MAP_KEY ?? '',
} as const;
