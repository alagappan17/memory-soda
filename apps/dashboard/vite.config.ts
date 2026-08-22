import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(
        env.NEXT_PUBLIC_API_URL ?? env.API_URL ?? 'http://localhost:3004'
      ),
    },
    server: {
      // Kept in step with CORS_ORIGIN on the API: both are written from the
      // same answer by create-memory-soda, and a mismatch shows up as browser
      // requests failing CORS rather than as an obvious port problem.
      port: Number(env.DASHBOARD_PORT) || 3000,
    },
  };
});
