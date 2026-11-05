import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 3002,
      host: '0.0.0.0',
      allowedHosts: true as const,
      // Same-origin API in development: /api/* is forwarded to the Express backend, so the
      // httpOnly refresh cookie works without any CORS/cookie configuration.
      proxy: {
        '/api': { target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
