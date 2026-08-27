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
    // VITE_API_URL is exposed by Vite itself from the root .env (loadEnv above
    // reads it), so there is no `define` here. Overriding it would discard the
    // value a production build passes on the command line.
    envDir: '../../',
    server: {
      // Kept in step with CORS_ORIGIN on the API: both are written from the
      // same answer by create-memory-soda, and a mismatch shows up as browser
      // requests failing CORS rather than as an obvious port problem.
      port: Number(env.DASHBOARD_PORT) || 3000,
    },
  };
});
