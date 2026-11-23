import { build } from 'vite';
import { resolve } from 'node:path';

/**
 * Bundles the TypeScript simulation smoke test with the project's own Vite
 * toolchain and runs it in Node. Keeps the test free of a separate test
 * framework while still exercising the real modules and bundle graph.
 */
const outDir = resolve('node_modules/.cache/terra-sim-smoke');

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: resolve('scripts/sim-smoke.ts'),
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'sim-smoke.mjs' },
    },
  },
});

await import(`${resolve(outDir, 'sim-smoke.mjs')}?t=${Date.now()}`);
