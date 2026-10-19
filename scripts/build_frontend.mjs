/** Deterministic offline production React bundle; no Node runtime in the image. */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'package.json'));
const version = (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim();
if (JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version !== version)
  throw Error('package.json and VERSION differ');
await fs.writeFile(
  path.join(root, 'static/version.js'),
  `export const VERSION = ${JSON.stringify(version)};\n`
);
const digest = (data) => createHash('sha256').update(data).digest('hex');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['static/react/main.jsx'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  tsconfigRaw: {},
  plugins: [
    {
      name: 'explicit-modules',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => ({
          path:
            args.path.startsWith('.') || args.path.startsWith('/')
              ? path.resolve(args.importer ? path.dirname(args.importer) : root, args.path)
              : require.resolve(args.path, {
                  paths: [args.importer ? path.dirname(args.importer) : root]
                })
        }));
        builder.onLoad({ filter: /\.(js|jsx|json)$/ }, async (args) => ({
          contents: await fs.readFile(args.path, 'utf8'),
          loader: args.path.endsWith('.json') ? 'json' : args.path.endsWith('.jsx') ? 'jsx' : 'js'
        }));
      }
    }
  ]
});
const bundle = result.outputFiles[0].text;
const sources = {};
async function visit(directory) {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (!['app.js', 'build-manifest.json'].includes(entry.name))
      sources[path.relative(root, file).split(path.sep).join('/')] = digest(
        await fs.readFile(file)
      );
  }
}
await visit(path.join(root, 'static'));
const manifest = JSON.stringify({ sources, bundle_sha256: digest(bundle) }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (
    (await fs.readFile(path.join(root, 'static/app.js'), 'utf8')) !== bundle ||
    (await fs.readFile(path.join(root, 'static/build-manifest.json'), 'utf8')) !== manifest
  )
    throw Error('Frontend bundle is stale; run npm run build');
} else {
  await fs.writeFile(path.join(root, 'static/app.js'), bundle);
  await fs.writeFile(path.join(root, 'static/build-manifest.json'), manifest);
}
