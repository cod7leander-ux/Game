import { build } from 'vite';
import { resolve } from 'node:path';

/**
 * Bundles and runs each headless test entry with the project's own Vite
 * toolchain. Keeps the suite free of a separate test framework while still
 * exercising the real module graph.
 */
const entries = [
  { entry: 'scripts/sim-smoke.ts', name: 'sim-smoke' },
  { entry: 'scripts/tactical-smoke.ts', name: 'tactical-smoke' },
];

for (const { entry, name } of entries) {
  const outDir = resolve(`node_modules/.cache/terra-${name}`);
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      ssr: resolve(entry),
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { entryFileNames: `${name}.mjs` } },
    },
  });
  await import(`${resolve(outDir, `${name}.mjs`)}?t=${Date.now()}`);
}
