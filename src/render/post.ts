import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Cheap post passes.
 *
 * HalfResAO: ground-truth AO computed at a fraction of the screen resolution from the main pass's own depth buffer
 * (normals reconstructed from depth), so unlike the stock GTAOPass it never renders the scene a second time, and it
 * multiplies the result straight onto the frame instead of copying the frame and blending it (no extra full-screen
 * passes, no buffer swap). The composer's render targets must carry a depth texture.
 */
export class HalfResAO extends Pass {
  readonly gtao: GTAOPass;
  private quad: FullScreenQuad;
  private blend: THREE.ShaderMaterial;
  private depth: THREE.DepthTexture | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number, readonly scale = 0.5, samples = 8, intensity = 0.85) {
    super();
    this.needsSwap = false;
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    this.gtao = new GTAOPass(scene, camera, w, h);
    // we feed depth ourselves: drop the pass's own normal/depth target (it would re-render the whole scene)
    const placeholder = new THREE.DepthTexture(1, 1);
    this.gtao.setGBuffer(placeholder, undefined);
    (this.gtao as any).normalRenderTarget.setSize(1, 1);
    (this.gtao as any).updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 2, scale: 1, samples });
    (this.gtao as any).updatePdMaterial({ samples: Math.min(8, samples), rings: 2, radius: 6 });
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: this.gtao.gtaoMap }, intensity: { value: intensity } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tAO; uniform float intensity; varying vec2 vUv; void main(){ float ao = texture2D(tAO, vUv).r; gl_FragColor = vec4(vec3(mix(1.0, ao, intensity)), 1.0); }',
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
    if (!d) return;
    if (d !== this.depth) {
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
    (this.gtao as any).normalRenderTarget.setSize(1, 1);
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
