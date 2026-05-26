import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: {
    compilerOptions: {
      composite: false,
      declarationMap: true,
    },
  },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  tsconfig: 'tsconfig.lib.json',
  external: [],
});
