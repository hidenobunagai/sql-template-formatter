// Bundle the extension and the CLI into one self-contained file each.
//
// sql-formatter (and its nearley/moo/argparse dependencies) are inlined, so
// neither the VSIX nor the npm package ships a node_modules tree: the VSIX
// stays a handful of files, activation reads one file instead of hundreds,
// and the npm tarball's CLI runs with no runtime dependencies installed.
// Type checking is `tsc --noEmit`; this script only emits.
import { build, context } from 'esbuild';
import { rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: { extension: 'src/extension.ts', cli: 'src/cli.ts' },
  outdir: 'out',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

// Stale per-module output (format.js, ordinals.js, …) from earlier tsc builds
// would otherwise be packaged next to the bundles.
rmSync('out', { recursive: true, force: true });

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
