import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'https://api.convenience.top';
  const apiOrigin = env.VITE_API_PROXY_ORIGIN || (
    new URL(apiTarget).hostname === 'api.convenience.top' ? 'https://convenience.top' : ''
  );

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
          configure(proxy) {
            if (apiOrigin) {
              proxy.on('proxyReq', (proxyReq) => {
                // Match the production API's strict Origin allowlist when using the hosted API.
                proxyReq.setHeader('Origin', apiOrigin);
              });
            }
          },
        },
      },
    },
  };
});
