import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Cheap post passes.
 *
 * FastAO: three's GTAO with the stock setup (12 samples, same radius, 16-tap denoise) that multiplies its result
 * straight onto the frame, instead of copying the whole frame to the other buffer first and blending onto the copy:
 * one full-screen pass and a buffer swap fewer, same image. With depthNormals it also skips the separate normal/depth
 * scene render and reads the main pass's depth texture (normals rebuilt from depth; the composer's targets then need
 * a depth texture) - cheaper still, but not pixel-identical (foliage a touch darker). `scale` < 1 = reduced resolution.
 */
export class FastAO extends Pass {
  readonly gtao: GTAOPass;
  private quad: FullScreenQuad;
  private blend: THREE.ShaderMaterial;
  private depth: THREE.DepthTexture | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number, readonly scale = 1, samples = 12, intensity = 0.85, pdSamples = 16, readonly depthNormals = false) {
    super();
    this.needsSwap = false;
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    this.gtao = new GTAOPass(scene, camera, w, h);
    if (depthNormals) {
      // we feed depth ourselves: drop the pass's own normal/depth target (it would re-render the whole scene)
      this.gtao.setGBuffer(new THREE.DepthTexture(1, 1), undefined);
      (this.gtao as any).normalRenderTarget.setSize(1, 1);
    }
    (this.gtao as any).updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 2, scale: 1, samples });
    if (pdSamples !== 16) (this.gtao as any).updatePdMaterial({ samples: pdSamples });
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: this.gtao.gtaoMap }, intensity: { value: intensity } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tAO; uniform float intensity; varying vec2 vUv; void main(){ gl_FragColor = vec4(mix(vec3(1.0), texture2D(tAO, vUv).rgb, intensity), 1.0); }',
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
    });
    this.quad = new FullScreenQuad(this.blend);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const d = readBuffer.depthTexture;
    if (this.depthNormals && d && d !== this.depth) {
      this.depth = d;
      const g = this.gtao as any;
      g.depthTexture = d;
      g.gtaoMaterial.uniforms.tDepth.value = d;
      g.pdMaterial.uniforms.tDepth.value = d;
    }
    (this.gtao as any).render(renderer, writeBuffer, readBuffer);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.render(renderer);
    renderer.autoClear = ac;
  }

  setSize(width: number, height: number): void {
    this.gtao.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
    if (this.depthNormals) (this.gtao as any).normalRenderTarget.setSize(1, 1);
  }

  dispose(): void {
    this.gtao.dispose();
    this.blend.dispose();
    this.quad.dispose();
  }
}

/** UnrealBloomPass whose blur chain runs at a fraction of the composer size (bloom is a blur: nobody can tell) */
export class ScaledBloom extends UnrealBloomPass {
  constructor(size: THREE.Vector2, strength: number, radius: number, threshold: number, readonly scale = 0.5) {
    super(new THREE.Vector2(Math.max(2, size.x * scale), Math.max(2, size.y * scale)), strength, radius, threshold);
  }
  setSize(width: number, height: number): void {
    super.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
  }
}
