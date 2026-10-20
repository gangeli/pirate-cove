// What the renderer is and how much work a frame is: draw calls, triangles, textures, programs, post passes.
//   PORT=5195 node scripts/gpuinfo.mjs "gpu=webgpu&q=high"   (headless flags let Chromium run WebGPU on SwiftShader too)
import { chromium } from 'playwright';
const extra = process.argv[2] ?? '';
const port = process.env.PORT ?? '5173';
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://localhost:${port}/?play=1&bot=1.5&seed=7&${extra}`);
await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
await p.waitForTimeout(8000);
console.log(JSON.stringify(await p.evaluate(() => {
  const w = window.__app.world, r = w.renderer;
  const gpu = !!r.isWebGPURenderer;
  const gl = gpu ? null : r.getContext();
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
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
    backend: w.backend, renderer: gpu ? w.gpu.renderer : dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: gpu ? w.gpu.vendor : dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '',
    calls: gpu ? info.render.drawCalls : info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: gpu ? info.memory.programs : info.programs?.length,
    meshes, shadowCasters, instanced, pixelRatio: r.getPixelRatio(), size: [r.domElement.width, r.domElement.height], quality: window.__app.quality,
    passes: w.composer?.passes?.map((x) => x.constructor.name) ?? (w.gpuPost ? ['RenderPipeline'] : null), shadowMap: w.sun?.shadow?.mapSize?.x,
  };
}), null, 1));
await b.close();
