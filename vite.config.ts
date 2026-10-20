import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * After a build, lists every file in the output directory with a content hash and writes that
 * list into dist/sw.js (replacing its BUILD placeholder). The service worker precaches the app
 * shell from it, caches assets/ lazily, and names its caches after the build hash, so every build
 * that changes any file installs as an update and stale caches are cleaned up.
 */
function pwa(): Plugin {
  let outDir = 'dist';
  return {
    name: 'bc-pwa-precache',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split(sep).join('/'));
        }
      };
      walk(outDir);
      files.sort();
      const shell: [string, string][] = [];
      const assets: [string, string, number][] = [];
      const all = createHash('sha256');
      for (const f of files) {
        if (f === 'sw.js' || f.startsWith('screenshots/')) continue; // store art only, never needed in game
        const buf = readFileSync(join(outDir, f));
        const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
        all.update(`${f}:${hash}\n`);
        const isShell =
          f === 'index.html' ||
          f === 'manifest.webmanifest' ||
          f.startsWith('icons/') ||
          f.startsWith('basis/') ||
          f.startsWith('draco/') ||
          /^assets\/[^/]+\.(js|css|woff2?)$/.test(f) || // Vite's hashed bundles and fonts
          f.endsWith('.json');
        // a .jpg with a compressed .ktx2 twin is only a fallback for browsers without KTX2: fetched (and cached) on demand, not bundled for offline
        if (/\.jpg$/.test(f) && files.includes(f.replace(/\.jpg$/, '.ktx2'))) continue;
        if (isShell) shell.push([f, hash]);
        else assets.push([f, hash, buf.length]);
      }
      const version = all.digest('hex').slice(0, 12);
      const sw = readFileSync(swPath, 'utf8');
      const marker = '/*__BC_BUILD__*/ null';
      if (!sw.includes(marker)) throw new Error('sw.js: BUILD placeholder not found');
      writeFileSync(swPath, sw.replace(marker, JSON.stringify({ version, shell, assets })));
      const mb = (n: number) => (n / 1e6).toFixed(1);
      const shellBytes = shell.reduce((a, [f]) => a + statSync(join(outDir, f)).size, 0);
      console.log(`[pwa] sw ${version}: precache ${shell.length} files (${mb(shellBytes)} MB), ${assets.length} lazy assets (${mb(assets.reduce((a, x) => a + x[2], 0))} MB)`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [pwa()],
  server: { host: '0.0.0.0', port: 5173 },
  // the WebGPU path is a dynamic import: pre-bundle its deps up front so the dev server doesn't re-optimise (and reload) on first use
  optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl', 'three/examples/jsm/tsl/display/BloomNode.js', 'three/examples/jsm/tsl/display/SMAANode.js', 'three/examples/jsm/tsl/display/FXAANode.js', 'three/examples/jsm/math/SimplexNoise.js', 'three/examples/jsm/shaders/GTAOShader.js'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120000 },
} as any);
