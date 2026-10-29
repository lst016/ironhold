import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Dev-only: tools/render3d.html posts rendered PNGs here, and they are written under assets-src/renders/.
function renderSink(): Plugin {
  const root = resolve('assets-src/renders');
  return {
    name: 'render-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__render/save', (req, res) => {
        const out = resolve(new URL(req.url ?? '', 'http://x').searchParams.get('path') ?? '');
        if (req.method !== 'POST' || !out.startsWith(root + sep) || !/\.(png|json)$/.test(out)) {
          res.statusCode = 400;
          res.end('bad path');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(dirname(out), { recursive: true });
          writeFileSync(out, Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [renderSink()],
  build: { chunkSizeWarningLimit: 2000 },
  // the battle's 3D view (src/scenes/fp3d.ts) is imported on demand; listing three here keeps the dev server
  // from discovering it mid-battle and reloading the page
  optimizeDeps: {
    include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js', 'three/examples/jsm/libs/meshopt_decoder.module.js', 'three/examples/jsm/utils/SkeletonUtils.js'],
  },
});
