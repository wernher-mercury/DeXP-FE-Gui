import { defineConfig, loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const NETLIFY_ORIGIN = env.NETLIFY_URL || 'http://localhost:3999';

  return {
    // 이제 index.html이 루트에 있으므로 root 설정 제거
    root: path.resolve(__dirname),
    base: '/',
    server: {
      port: Number(env.VITE_PORT || 5173),
      open: true,
      proxy: {
        '/.netlify/functions/': {
          target: NETLIFY_ORIGIN,
          changeOrigin: true,
          ws: true,
          secure: false,
          timeout: 120000,
          proxyTimeout: 120000,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.error('[vite-proxy-error]', err?.code, err?.message);
            });
            proxy.on('proxyRes', (proxyRes, req) => {
              // 디버그 원하면 주석 해제
              // console.log('[proxyRes]', req.method, req.url, proxyRes.statusCode)
            });
          },
        },
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
