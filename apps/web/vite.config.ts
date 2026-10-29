import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'https://api.convenience.top';
  const apiOrigin = env.VITE_API_PROXY_ORIGIN || (
    new URL(apiTarget).hostname === 'api.convenience.top' ? 'https://convenience.top' : ''
  );
  // Do not make the separate share site at / installable by default.
  const base = env.VITE_APP_BASE || (mode === 'production' ? '/app/' : '/');
  const enablePwa = mode === 'production' && (base === '/app/' || env.VITE_ENABLE_PWA === 'true');

  return {
    // Main app lives under /app/; the same source can be built for the share host at /.
    base,
    plugins: [react(), tailwindcss(), VitePWA({
      disable: !enablePwa,
      injectRegister: null,
      registerType: 'prompt',
      includeAssets: ['brand-mark.svg', 'pwa-apple.png'],
      manifest: {
        id: base,
        name: '迹光 · 旅行素材网盘',
        short_name: '迹光',
        description: '收藏旅途中的照片与视频',
        lang: 'zh-CN',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#eff8f6',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    })],
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
