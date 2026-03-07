import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/meshy': {
          target: 'https://api.meshy.ai',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/meshy/, '/openapi/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Authorization', `Bearer ${env.MESHY_API_KEY}`);
            });
          },
        },
        '/api/proxy-download': {
          target: 'https://assets.meshy.ai',
          changeOrigin: true,
          rewrite: (path) => {
            const url = new URLSearchParams(path.split('?')[1]).get('url');
            if (!url) return path;
            const parsed = new URL(url);
            return parsed.pathname + parsed.search;
          },
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const raw = req.url ?? '';
              const url = new URLSearchParams(raw.split('?')[1]).get('url');
              if (url) {
                const parsed = new URL(url);
                proxyReq.setHeader('Host', parsed.host);
              }
            });
          },
        },
      },
    },
  };
});
