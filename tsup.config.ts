import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // Side-effecting entry that registers the <bonnie-pdf-previewer> element.
    // Kept separate so consumers can import the factory API without the global
    // registration (e.g. to register under a custom tag name).
    element: 'src/element.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'browser',
  target: 'es2022',
  splitting: true,
  treeshake: true,
  minify: true,
  clean: true,
  outDir: 'dist',
});
