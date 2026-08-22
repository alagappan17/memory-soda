import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: {
    // Inline @memory-soda/types into the emitted .d.ts. It is a private
    // workspace package, so a declaration that imports from it would leave
    // every published consumer with an unresolvable module.
    resolve: true,
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
