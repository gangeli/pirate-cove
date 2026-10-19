// What the renderer is and how much work a frame is: draw calls, triangles, textures, programs, post passes.
import { chromium } from 'playwright';
const extra = process.argv[2] ?? '';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://localhost:5173/?play=1&bot=1.5&seed=7&${extra}`);
await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
await p.waitForTimeout(8000);
console.log(JSON.stringify(await p.evaluate(() => {
  const w = window.__app.world, r = w.renderer;
  const gl = r.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const info = r.info;
  let meshes = 0, tris = 0, shadowCasters = 0, instanced = 0;
  w.scene.traverse((o) => {
    if (o.isMesh && o.visible) {
      meshes++;
      if (o.castShadow) shadowCasters++;
      if (o.isInstancedMesh) instanced++;
    }
  });
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '',
    calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length,
    meshes, shadowCasters, instanced, pixelRatio: r.getPixelRatio(), size: [r.domElement.width, r.domElement.height], quality: window.__app.quality,
    passes: w.composer?.passes?.map((x) => x.constructor.name), shadowMap: w.sun?.shadow?.mapSize?.x,
  };
}), null, 1));
await b.close();
