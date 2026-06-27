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
      conditions: ['@memory-soda/source'],
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(
        env.NEXT_PUBLIC_API_URL ?? env.API_URL ?? 'http://localhost:3004'
      ),
    },
    server: {
      port: 3000,
    },
  };
});
