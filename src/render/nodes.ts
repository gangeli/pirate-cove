/**
 * The WebGPU path: three's WebGPURenderer with node (TSL) materials and post chain. Loaded on demand (world.ts) only
 * when that renderer is chosen, so WebGL players never download or parse it.
 *
 * Every custom GLSL material of the WebGL path has its twin here, drawing the same image:
 *  terrain splatting, water, GPU-skinned crowds, baked building AO, flag waves, vegetation wind, particles, sky,
 *  the r170 shadow filters, lighting and environment (see legacy/r170.ts), GTAO + Poisson denoise, bloom, SMAA/FXAA.
 *
 * TSL is typed loosely here (`any`): the node graph is checked by the shader compiler, and the WebGL twin of each
 * function sits next to the view that uses it.
 */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import BloomNode from 'three/examples/jsm/tsl/display/BloomNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { generateMagicSquareNoise } from 'three/examples/jsm/shaders/GTAOShader.js';
import * as GL from 'three';
import { Sky as GLSky } from './legacy/sky170';
import { PMREMGenerator as GLPMREM170 } from './legacy/pmrem170';

const T: any = TSL;
const {
  Fn, If, float, int, vec2, vec3, vec4, ivec2, uniform, reference, attribute, texture, textureLoad, varying, varyingProperty,
  positionLocal, positionGeometry, positionWorld, positionView, positionViewDirection, normalLocal, normalGeometry, normalView, normalViewGeometry, normalWorld,
  modelWorldMatrix, modelViewMatrix, modelViewProjection, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix,
  instanceIndex, mix, smoothstep, clamp, max, min, abs, floor, fract, sin, cos, pow, exp, sqrt, acos, dot, cross, normalize, select,
  dFdx, dFdy, uv, screenSize, Discard, pass, mrt, output, diffuseColor, mat3, mat4, add, mul, sub,
  negateOnBackSide, renderGroup, isolate, roughness, materialEnvIntensity, pmremTexture, BRDF_Lambert, specularColorBlended,
  specularF90, diffuseContribution, instancedBufferAttribute, transformNormalToView,
} = T;

export { THREE };
export type WebGPURenderer = THREE.WebGPURenderer;

// ================================================================================================= renderer

/**
 * three r186 passes `swizzle: 'rgba'` in every texture view descriptor. Browsers whose texture-component-swizzle
 * implementation predates the final string form (Chromium ~141 among them) reject that with a TypeError, so the
 * identity swizzle (the default anyway) is dropped before it reaches them.
 */
function guardIdentitySwizzle(): void {
  const P = (globalThis as any).GPUTexture?.prototype;
  if (!P || P.__bcSwizzle) return;
  const createView = P.createView;
  P.createView = function (this: GPUTexture, d?: GPUTextureViewDescriptor & { swizzle?: unknown }) {
    if (d && d.swizzle === 'rgba') {
      const { swizzle, ...rest } = d;
      void swizzle;
      return createView.call(this, rest);
    }
    return createView.call(this, d);
  };
  P.__bcSwizzle = true;
}

export async function createRenderer(canvas: HTMLCanvasElement, forceWebGL = false): Promise<THREE.WebGPURenderer> {
  installR170Nodes();
  guardIdentitySwizzle();
  if (location.search.includes('tsltrace')) (THREE.Node as any).captureStackTrace = true;
  const r = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', forceWebGL });
  // the experimental renderer must never strand a player on a black screen: if the GPU device goes away, save,
  // forget the WebGPU choice and come back on WebGL (which is the default, so this cannot loop)
  (r as unknown as { onDeviceLost: (info: unknown) => void }).onDeviceLost = (info) => {
    console.error('WebGPU device lost; falling back to WebGL', info);
    const app = (window as unknown as { __app?: { state?: string; save?: (slot: string) => Promise<void> } }).__app;
    const back = () => {
      try {
        localStorage.removeItem('bc.renderer');
      } catch {
        /* ignore */
      }
      const u = new URL(location.href);
      u.searchParams.set('gpu', 'webgl');
      if (app?.state === 'game') u.searchParams.set('continue', '1');
      location.replace(u.toString());
    };
    // the GPU is already gone, so there is no hurry: give a late-game save on a phone time to reach IndexedDB
    Promise.race([app?.state === 'game' ? app.save?.('auto') : undefined, new Promise((res) => setTimeout(res, 10000))]).finally(back);
  };
  await r.init();
  return r;
}

/** the adapter behind the renderer (renderer string for the settings and profiler, software detection) */
export function adapterInfo(r: THREE.WebGPURenderer, adapter: GPUAdapter | null): { vendor: string; architecture: string; description: string; fallback: boolean } {
  const b = r.backend as any;
  if (!b?.isWebGPUBackend) return { vendor: '', architecture: 'WebGL 2 backend', description: '', fallback: false };
  const info = b.device?.adapterInfo ?? (adapter as any)?.info ?? {};
  return { vendor: info.vendor ?? '', architecture: info.architecture ?? '', description: info.description ?? '', fallback: !!(info.isFallbackAdapter ?? (adapter as any)?.info?.isFallbackAdapter) };
}

// ================================================================================================= output on the low tier

/**
 * The low tier renders straight to the canvas. WebGL tone maps and encodes sRGB inside every material (then fog, in
 * that order); WebGPURenderer would instead render to a half-float target and run a full-screen output pass. That costs
 * a frame-sized buffer and a pass on exactly the devices that can least afford it, so with `inlineOutput` the renderer
 * is told to output linear and every node material applies tone mapping and sRGB itself, in WebGL's order. Materials
 * flagged userData.rawOutput (the particles, as WebGL's raw ShaderMaterial) skip it, as on WebGL.
 */
let inlineOutput = false;
export function setInlineOutput(r: THREE.WebGPURenderer, on: boolean): void {
  inlineOutput = on;
  r.toneMapping = on ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  r.outputColorSpace = on ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
}

/**
 * ACES (with the renderer's exposure) then sRGB, alpha untouched: WebGL's tonemapping + colorspace chunks and its
 * OutputPass. (renderOutput() would also un-premultiply the colour, which shifts every translucent pixel.)
 */
function toneMapSRGB(color: any, toneMapped = true): any {
  const c = vec4(color);
  const t = toneMapped ? c.toneMapping(THREE.ACESFilmicToneMapping) : c;
  return t.workingToColorSpace(THREE.SRGBColorSpace);
}

let patched = false;
function installR170Nodes(): void {
  if (patched) return;
  patched = true;
  const NM = THREE.NodeMaterial.prototype as any;
  const origOutput = NM.setupOutput;
  NM.setupOutput = function (this: any, builder: any, outputNode: any) {
    if (!inlineOutput || this.userData?.rawOutput || builder.renderer.getRenderTarget() !== null) return origOutput.call(this, builder, outputNode);
    outputNode = toneMapSRGB(outputNode, this.toneMapped);
    if (this.fog === true) outputNode = this.setupFog(builder, outputNode);
    if (this.premultipliedAlpha === true) outputNode = this.setupPremultipliedAlpha(builder, outputNode);
    return outputNode;
  };
  const origKey = NM.customProgramCacheKey;
  NM.customProgramCacheKey = function (this: any) {
    return origKey.call(this) + (inlineOutput && !this.userData?.rawOutput ? '|io' : '');
  };
  patchLighting();
}

// ================================================================================================= r170 lighting

/** r170's analytic DFG fit ("Physically Based Shading on Mobile"); r186 reads a LUT */
const DFGApprox170 = Fn(([nrm, viewDir, rough]: any[]) => {
  const dotNV = dot(nrm, viewDir).clamp();
  const c0 = vec4(-1, -0.0275, -0.572, 0.022);
  const c1 = vec4(1, 0.0425, 1.04, -0.04);
  const r = rough.mul(c0).add(c1).toVar();
  const a004 = min(r.x.mul(r.x), T.exp2(dotNV.mul(-9.28))).mul(r.x).add(r.y);
  return vec2(-1.04, 1.04).mul(a004).add(r.zw);
}).setLayout({ name: 'DFGApprox170', type: 'vec2', inputs: [{ name: 'normal', type: 'vec3' }, { name: 'viewDir', type: 'vec3' }, { name: 'roughness', type: 'float' }] });

/** r170's GGX specular: as r186's, but with the visibility term clamped to 1 as r170 had it */
const BRDF_GGX170 = Fn(([lightDirection, f0]: any[]) => {
  const alpha = roughness.pow2().toVar();
  const halfDir = lightDirection.add(positionViewDirection).normalize();
  const dotNL = normalView.dot(lightDirection).clamp().toVar();
  const dotNV = normalView.dot(positionViewDirection).clamp().toVar();
  const dotNH = normalView.dot(halfDir).clamp();
  const dotVH = positionViewDirection.dot(halfDir).clamp();
  const F = T.F_Schlick({ f0, f90: float(1), dotVH });
  const a2 = alpha.pow2().toVar();
  const gv = dotNL.mul(a2.add(a2.oneMinus().mul(dotNV.pow2())).sqrt());
  const gl = dotNV.mul(a2.add(a2.oneMinus().mul(dotNL.pow2())).sqrt());
  const V = float(0.5).div(gv.add(gl)).clamp();
  const D = T.D_GGX({ alpha, dotNH });
  return F.mul(V).mul(D);
}); // (no layout: it reads the shading globals normalView, roughness, positionViewDirection)

/**
 * The same r170 restorations as legacy/r170.ts, on the node lighting model: direct light without the (1 - F) diffuse
 * factor and the multi-scattering compensation, the hemisphere light without energy conservation, image-based light
 * with r170's DFG fit and max-channel energy split, and the r170 reflection bend (roughness^2).
 */
function patchLighting(): void {
  const P = (THREE as any).PhysicalLightingModel.prototype;
  // r186's start() also samples its DFG lookup table for the multi-scattering terms the r170 model doesn't have; that
  // texture would be the terrain's 17th (WebGPU allows 16 per stage). Plain materials go straight to the base start().
  const origStart = P.start, baseStart = Object.getPrototypeOf(P).start;
  P.start = function (this: any, builder: any) {
    if (this.clearcoat || this.sheen || this.iridescence || this.transmission) return origStart.call(this, builder);
    return baseStart.call(this, builder);
  };
  P.direct = function ({ lightDirection, lightColor, reflectedLight }: any) {
    const dotNL = normalView.dot(lightDirection).clamp();
    const irradiance = dotNL.mul(lightColor).toVar();
    const specularBRDF = BRDF_GGX170(lightDirection, specularColorBlended);
    reflectedLight.directDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor: diffuseContribution })));
    reflectedLight.directSpecular.addAssign(irradiance.mul(specularBRDF));
  };
  P.indirectDiffuse = function (builder: any) {
    const { irradiance, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor: diffuseContribution })));
  };
  P.indirectSpecular = function (builder: any) {
    const { radiance, iblIrradiance, reflectedLight } = builder.context;
    const fab = DFGApprox170(normalView, positionViewDirection, roughness).toVar();
    const Fr = specularColorBlended;
    const FssEss = Fr.mul(fab.x).add(specularF90.mul(fab.y)).toVar();
    const Ess = fab.x.add(fab.y);
    const Ems = Ess.oneMinus().toVar();
    const Favg = Fr.add(Fr.oneMinus().mul(0.047619));
    const Fms = FssEss.mul(Favg).div(Ems.mul(Favg).oneMinus());
    const single = FssEss, multi = Fms.mul(Ems).toVar();
    const total = single.add(multi);
    const diffuse = diffuseContribution.mul(max(max(total.r, total.g), total.b).oneMinus());
    const cosineWeightedIrradiance = iblIrradiance.mul(1 / Math.PI);
    reflectedLight.indirectSpecular.addAssign(radiance.mul(single).add(multi.mul(cosineWeightedIrradiance)));
    reflectedLight.indirectDiffuse.addAssign(diffuse.mul(cosineWeightedIrradiance));
  };
  // shadow normal bias along the vertex normal, as WebGL's shadowmap_vertex (r186 nodes offset along the shading
  // normal: normal-mapped, and flipped on the back of double-sided leaves, which moves their self-shadowing)
  const SN = (THREE as any).ShadowNode.prototype;
  const origShadowPos = SN.setupShadowPosition;
  SN.setupShadowPosition = function (this: any, builder: any) {
    origShadowPos.call(this, builder);
    if (builder.material.receivedShadowPositionNode || builder.context.shadowPositionWorld) return;
    const nb = reference('normalBias', 'float', this.shadow).setGroup(renderGroup);
    const vtx = T.vertexStage(transformNormalToView(normalLocal).transformNormalByInverseViewMatrix(cameraViewMatrix));
    T.shadowPositionWorld.addAssign(vtx.sub(normalWorld).mul(nb));
  };
  const E = (THREE as any).EnvironmentNode.prototype;
  E.setup = function (builder: any) {
    const { material } = builder;
    let envNode = this.envNode;
    if (envNode.isTextureNode || envNode.isMaterialReferenceNode) {
      const value = envNode.isTextureNode ? envNode.value : material[envNode.property];
      const cache = this._getPMREMNodeCache(builder.renderer);
      let c = cache.get(value);
      if (c === undefined) cache.set(value, (c = pmremTexture(value)));
      envNode = c;
    }
    const radianceCtx = {
      getUV: () => {
        let rv = positionViewDirection.negate().reflect(normalView);
        rv = roughness.mul(roughness).mix(rv, normalView).normalize();
        return rv.transformDirection(cameraWorldMatrix);
      },
      getTextureLevel: () => roughness,
    };
    const radiance = isolate(envNode.context(radianceCtx).mul(materialEnvIntensity));
    const irradiance = isolate(envNode.context({ getUV: () => normalWorld, getTextureLevel: () => float(1.0) }).mul(Math.PI).mul(materialEnvIntensity));
    builder.context.radiance.addAssign(radiance);
    builder.context.iblIrradiance.addAssign(irradiance);
  };
}

// ================================================================================================= r170 shadow filters

/** r170's PCFSoftShadowMap (radius < 0) and PCFShadowMap filters on hardware-compare taps; see legacy/r170.ts */
export const shadowFilter170 = Fn(({ depthTexture, shadowCoord, shadow }: any) => Fn(() => {
  const mapSize = reference('mapSize', 'vec2', shadow).setGroup(renderGroup);
  const radius = reference('radius', 'float', shadow).setGroup(renderGroup);
  const texel = vec2(1).div(mapSize).toVar();
  const tap = (o: any) => texture(depthTexture, shadowCoord.xy.add(o)).compare(shadowCoord.z);
  const snap = (o: any) => texture(depthTexture, floor(shadowCoord.xy.add(o).mul(mapSize)).add(0.5).mul(texel)).compare(shadowCoord.z);
  const s = float(0).toVar();
  If(radius.lessThan(0), () => {
    let acc: any = null;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) acc = acc ? acc.add(tap(texel.mul(vec2(i, j)))) : tap(texel.mul(vec2(i, j)));
    s.assign(acc.mul(1 / 9));
  }).Else(() => {
    const d1 = texel.mul(radius).toVar(), d2 = d1.mul(0.5).toVar();
    const offs = [
      vec2(d1.x.negate(), d1.y.negate()), vec2(0, d1.y.negate()), vec2(d1.x, d1.y.negate()),
      vec2(d2.x.negate(), d2.y.negate()), vec2(0, d2.y.negate()), vec2(d2.x, d2.y.negate()),
      vec2(d1.x.negate(), 0), vec2(d2.x.negate(), 0), vec2(0, 0), vec2(d2.x, 0), vec2(d1.x, 0),
      vec2(d2.x.negate(), d2.y), vec2(0, d2.y), vec2(d2.x, d2.y),
      vec2(d1.x.negate(), d1.y), vec2(0, d1.y), vec2(d1.x, d1.y),
    ];
    let acc: any = null;
    for (const o of offs) acc = acc ? acc.add(snap(o)) : snap(o);
    s.assign(acc.mul(1 / 17));
  });
  return s;
})());

// ================================================================================================= sky and environment

export interface SkyUniforms {
  turbidity: { value: number };
  rayleigh: { value: number };
  mieCoefficient: { value: number };
  mieDirectionalG: { value: number };
  sunPosition: { value: GL.Vector3 };
}

/** three r170's SkyMesh (the Preetham sky of legacy/sky170.ts), ported to r186 TSL as a MeshBasicNodeMaterial */
export function createSky(): { mesh: THREE.Mesh; uniforms: SkyUniforms } {
  const turbidity = uniform(2), rayleigh = uniform(1), mieCoefficient = uniform(0.005), mieDirectionalG = uniform(0.8);
  const sunPosition = uniform(new THREE.Vector3());
  const up = vec3(0, 1, 0);
  const vSunDirection = varyingProperty('vec3', 'vSunDirection');
  const vSunE = varyingProperty('float', 'vSunE');
  const vSunfade = varyingProperty('float', 'vSunfade');
  const vBetaR = varyingProperty('vec3', 'vBetaR');
  const vBetaM = varyingProperty('vec3', 'vBetaM');
  const vertexNode = Fn(() => {
    const e = float(2.718281828459045);
    const totalRayleigh = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
    const MieConst = vec3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
    const cutoffAngle = float(1.6110731556870734), steepness = float(1.5), EE = float(1000.0);
    const sd = normalize(sunPosition);
    vSunDirection.assign(sd);
    const zenithAngleCos = clamp(dot(sd, up), -1, 1);
    vSunE.assign(EE.mul(max(0.0, float(1.0).sub(pow(e, cutoffAngle.sub(acos(zenithAngleCos)).div(steepness).negate())))));
    const fade = float(1.0).sub(clamp(float(1.0).sub(exp(sunPosition.y.div(450000.0))), 0, 1)).toVar();
    vSunfade.assign(fade);
    const rayleighCoefficient = rayleigh.sub(float(1.0).mul(float(1.0).sub(fade)));
    vBetaR.assign(totalRayleigh.mul(rayleighCoefficient));
    const c = float(0.2).mul(turbidity).mul(10e-18);
    vBetaM.assign(float(0.434).mul(c).mul(MieConst).mul(mieCoefficient));
    const position = modelViewProjection;
    return vec4(position.x, position.y, position.w, position.w); // z = w: on the far plane
  })();
  const colorNode = Fn(() => {
    const pi = float(3.141592653589793);
    const rayleighZenithLength = float(8.4e3), mieZenithLength = float(1.25e3);
    const sunAngularDiameterCos = float(0.9999566769464484);
    const THREE_OVER_SIXTEENPI = float(0.05968310365946075), ONE_OVER_FOURPI = float(0.07957747154594767);
    const direction = normalize(positionWorld.sub(cameraPosition)).toVar();
    const zenithAngle = acos(max(0.0, dot(up, direction))).toVar();
    const inverse = float(1.0).div(cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(180.0).div(pi)), -1.253))));
    const sR = rayleighZenithLength.mul(inverse), sM = mieZenithLength.mul(inverse);
    const Fex = exp(mul(vBetaR, sR).add(mul(vBetaM, sM)).negate()).toVar();
    const cosTheta = dot(direction, vSunDirection).toVar();
    const cc = cosTheta.mul(0.5).add(0.5);
    const rPhase = THREE_OVER_SIXTEENPI.mul(float(1.0).add(pow(cc, 2.0)));
    const betaRTheta = vBetaR.mul(rPhase);
    const g2 = pow(mieDirectionalG, 2.0);
    const inv = float(1.0).div(pow(float(1.0).sub(float(2.0).mul(mieDirectionalG).mul(cosTheta)).add(g2), 1.5));
    const mPhase = ONE_OVER_FOURPI.mul(float(1.0).sub(g2)).mul(inv);
    const betaMTheta = vBetaM.mul(mPhase);
    const ratio = vSunE.mul(add(betaRTheta, betaMTheta).div(add(vBetaR, vBetaM))).toVar();
    const Lin = pow(ratio.mul(sub(1.0, Fex)), vec3(1.5)).toVar();
    Lin.mulAssign(mix(vec3(1.0), pow(ratio.mul(Fex), vec3(1.0 / 2.0)), clamp(pow(sub(1.0, dot(up, vSunDirection)), 5.0), 0.0, 1.0)));
    const L0 = vec3(0.1).mul(Fex).toVar();
    const sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos.add(0.00002), cosTheta);
    L0.addAssign(vSunE.mul(19000.0).mul(Fex).mul(sundisk));
    const texColor = add(Lin, L0).mul(0.04).add(vec3(0.0, 0.0003, 0.00075));
    return vec4(pow(texColor, vec3(float(1.0).div(float(1.2).add(vSunfade.mul(1.2))))), 1.0);
  })();
  const material = new THREE.MeshBasicNodeMaterial();
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.fog = false;
  material.vertexNode = vertexNode;
  material.colorNode = colorNode;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.frustumCulled = false;
  return { mesh, uniforms: { turbidity, rayleigh, mieCoefficient, mieDirectionalG, sunPosition } as unknown as SkyUniforms };
}

/**
 * The environment map, made exactly as the WebGL path makes it (r170 sky, r170 PMREM blur chain) on a throwaway
 * WebGL2 context, read back and handed to WebGPU as a CubeUV data texture. The sky never changes during a game, so
 * this runs once at startup (a few dozen ms); r186's own node PMREM filters with GGX importance sampling and would
 * light rough surfaces ~1% brighter than the WebGL path. Null if WebGL2 isn't available (the caller then uses three's).
 */
export function bakeEnvironment(params: Record<string, number>, sunDir: GL.Vector3): THREE.DataTexture | null {
  let gl: GL.WebGLRenderer | null = null;
  if (location.search.includes('nobake')) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    gl = new GL.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl.capabilities.isWebGL2) return null;
    const pmrem = new GLPMREM170(gl);
    const scene = new GL.Scene();
    const sky = new GLSky() as unknown as GL.Mesh<GL.BoxGeometry, GL.ShaderMaterial>;
    sky.scale.setScalar(1000);
    for (const k of Object.keys(params)) sky.material.uniforms[k].value = params[k];
    sky.material.uniforms.sunPosition.value.copy(sunDir);
    scene.add(sky);
    const rt = pmrem.fromScene(scene, 0.02) as GL.WebGLRenderTarget;
    const W = rt.width, H = rt.height;
    // copy into a float target: reading back half floats isn't guaranteed, RGBA/FLOAT is with EXT_color_buffer_float
    const ft = new GL.WebGLRenderTarget(W, H, { type: GL.FloatType, depthBuffer: false, minFilter: GL.NearestFilter, magFilter: GL.NearestFilter });
    const copy = new GL.ShaderMaterial({
      uniforms: { t: { value: rt.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texelFetch(t, ivec2(gl_FragCoord.xy), 0); }',
      depthTest: false,
      depthWrite: false,
    });
    const quad = new GL.Mesh(new GL.PlaneGeometry(2, 2), copy);
    const cam = new GL.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    gl.setRenderTarget(ft);
    gl.render(quad, cam);
    const px = new Float32Array(W * H * 4);
    gl.readRenderTargetPixels(ft, 0, 0, W, H, px);
    gl.setRenderTarget(null);
    const half = new Uint16Array(px.length);
    for (let i = 0; i < px.length; i++) half[i] = GL.DataUtils.toHalfFloat(px[i]);
    for (const x of [ft, rt]) x.dispose();
    copy.dispose();
    quad.geometry.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    pmrem.dispose();
    const tex = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.CubeUVReflectionMapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch (e) {
    console.warn('environment bake', e);
    return null;
  } finally {
    if (gl) {
      gl.dispose();
      gl.forceContextLoss();
    }
  }
}

// ================================================================================================= shared helpers

type U<V = unknown> = { value: V };
/** a node that reads `obj.value` every frame (the views keep plain { value } uniforms for both backends) */
const ref = (obj: U, type: string) => reference('value', type, obj);

const hash12 = Fn(([p]: any[]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const vnoise = Fn(([p]: any[]) => {
  const i = floor(p).toVar();
  const f0 = fract(p);
  const f = f0.mul(f0).mul(f0.mul(-2.0).add(3.0)).toVar();
  return mix(mix(hash12(i), hash12(i.add(vec2(1, 0))), f.x), mix(hash12(i.add(vec2(0, 1))), hash12(i.add(vec2(1, 1))), f.x), f.y);
}).setLayout({ name: 'vnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// ================================================================================================= terrain

/**
 * Splatted terrain (terrain.ts has the GLSL twin). All shading inputs (colour, normal, roughness, overlay glow) are
 * computed once at the start of the fragment shader, where the WebGL version computes them in its map/normal chunks;
 * the material reads them back through normalNode/roughnessNode/emissiveNode. Keeping colorNode empty also keeps the
 * shadow pass from evaluating any of it.
 */
class TerrainNodeMaterial extends THREE.MeshStandardNodeMaterial {
  shade: (() => void) | null = null;
  setupDiffuseColor(builder: any): void {
    super.setupDiffuseColor(builder);
    this.shade?.();
  }
}

export interface TerrainNodes {
  material: THREE.Material;
  roads: { value: THREE.Texture };
  overlay: { value: THREE.Texture };
}

export function terrainMaterial(tex: Record<string, THREE.Texture>, nrm: Record<string, THREE.Texture>, u: { uTime: U<number>; uMapN: U<number>; uOverlayOn: U<number> }, roadsTex: THREE.Texture, overlayTex: THREE.Texture): TerrainNodes {
  const mat = new TerrainNodeMaterial({ roughness: 0.95, metalness: 0 });
  const roads = texture(roadsTex), overlay = texture(overlayTex);
  const uTime = ref(u.uTime, 'float'), uMapN = ref(u.uMapN, 'float'), uOverlayOn = ref(u.uOverlayOn, 'float');
  const vSplat = attribute('aSplat', 'vec4');
  const vDirt = attribute('aDirt', 'float');
  const vWNorm = varying(modelWorldMatrix.mul(vec4(normalGeometry, 0)).xyz.normalize());
  const outNormal = T.property('vec3', 'bcTerrainNormal');
  const outRough = T.property('float', 'bcTerrainRough');
  const outGlow = T.property('vec3', 'bcTerrainGlow');
  const rot = (p: any) => vec2(p.x.mul(0.8).add(p.y.mul(0.6)), p.x.mul(-0.6).add(p.y.mul(0.8)));

  const shade = Fn(() => {
    const wpos = positionWorld.toVar();
    const xz = wpos.xz.toVar();
    const tuv = xz.mul(0.22).toVar();
    const tdx = dFdx(tuv).toVar(), tdy = dFdy(tuv).toVar();
    // sample texture twice at different scales and rotation to kill tiling (explicit gradients: layers are skipped where their weight is 0)
    const AT = (t: THREE.Texture, s: number) => {
      const uvs = tuv.mul(s), dx = tdx.mul(s), dy = tdy.mul(s);
      const a = texture(t, uvs).grad(dx, dy);
      const uv2 = rot(uvs).mul(0.37).add(0.13);
      const b = texture(t, uv2).grad(rot(dx).mul(0.37), rot(dy).mul(0.37));
      const m = smoothstep(0.3, 0.7, vnoise(uvs.mul(0.35)));
      return mix(a, b, m.mul(0.6));
    };
    const nz = vnoise(xz.mul(0.15)).mul(0.6).add(vnoise(xz.mul(0.6)).mul(0.4)).toVar();
    const w = vec4(vSplat).toVar();
    w.x.mulAssign(nz.mul(0.6).add(0.7));
    w.y.mulAssign(nz.oneMinus().mul(0.6).add(0.7));
    w.z.mulAssign(nz.mul(0.4).add(0.8));
    const slope = float(1.0).sub(clamp(vWNorm.y, 0.0, 1.0));
    const cliffW = smoothstep(0.35, 0.6, slope).toVar();
    w.w.addAssign(cliffW.mul(1.5));
    w.assign(max(w, 0.0));
    w.divAssign(max(0.0001, w.x.add(w.y).add(w.z).add(w.w)));
    // roads (terrain.ts explains): 4 taps 0.3 tiles apart for a round outline, the single tap's tent profile for the ruts
    const ruv = xz.div(uMapN).toVar();
    const rh = float(0.3).div(uMapN).toVar();
    const rtap = (dx: number, dy: number) => roads.sample(ruv.add(vec2(rh.mul(dx), rh.mul(dy)))).level(0).r;
    const road0 = roads.sample(ruv).level(0).r.toVar();
    const roadV = rtap(-1, -1).add(rtap(1, -1)).add(rtap(-1, 1)).add(rtap(1, 1)).mul(0.25).toVar();
    const roadW = smoothstep(0.3, 0.5, roadV.add(vnoise(xz.mul(1.7)).sub(0.5).mul(0.16))).toVar();
    const padW = smoothstep(0.3, 0.95, vDirt.add(nz.sub(0.5).mul(0.5))).mul(0.75).toVar();
    const dirtW = max(padW, roadW).toVar();
    // pebble cells, faded out once a cell is only a few pixels (derivatives taken here, in uniform control flow)
    const pp = xz.mul(6.0).toVar();
    const pebFade = float(1.0).sub(smoothstep(0.2, 0.45, T.length(T.fwidth(pp)))).toVar();
    const wet = float(1.0).sub(smoothstep(0.0, 0.45, wpos.y)).toVar();
    const col = vec3(0.0).toVar();
    If(w.x.greaterThan(0.0), () => {
      const sand = AT(tex.sand, 0.8).rgb.toVar();
      sand.assign(mix(vec3(dot(sand, vec3(0.33))), sand, 0.5).mul(vec3(1.42, 1.26, 0.98)));
      If(wet.greaterThan(0.0), () => {
        sand.assign(mix(sand, AT(tex.wetsand, 1.0).rgb.mul(vec3(0.95, 0.9, 0.8)), wet));
      });
      col.addAssign(sand.mul(w.x));
    });
    If(w.y.greaterThan(0.0), () => {
      const grass = AT(tex.grass, 1.0).rgb.toVar();
      const gl = dot(grass, vec3(0.3, 0.59, 0.11));
      col.addAssign(mix(vec3(gl), grass, 1.25).mul(vec3(0.62, 0.98, 0.42)).mul(w.y));
    });
    If(w.z.greaterThan(0.0), () => {
      col.addAssign(AT(tex.jungle, 1.2).rgb.mul(vec3(0.62, 0.78, 0.45)).mul(w.z));
    });
    If(w.w.greaterThan(0.0), () => {
      const rock = AT(tex.rock, 0.6).rgb.toVar();
      If(cliffW.greaterThan(0.0), () => {
        rock.assign(mix(rock, AT(tex.cliff, 0.35).rgb.mul(vec3(0.85, 0.8, 0.72)), cliffW));
      });
      col.addAssign(rock.mul(w.w));
    });
    If(dirtW.greaterThan(0.0), () => {
      const dirt = AT(tex.dirt, 0.9).rgb.toVar();
      col.assign(mix(col, dirt.mul(vec3(1.05, 0.92, 0.78)), padW.mul(0.95)));
      If(roadW.greaterThan(0.0), () => {
        // packed earth, ruts, a compacted rim (not across doorways) and pebbles: see terrain.ts
        const road = mix(vec3(dot(dirt, vec3(0.333))), dirt, 0.6).mul(vec3(0.62, 0.47, 0.32)).toVar();
        const rut = smoothstep(0.6, 0.7, road0).mul(float(1.0).sub(smoothstep(0.78, 0.88, road0)));
        road.mulAssign(float(1.0).sub(rut.mul(vnoise(xz.mul(3.1)).mul(0.45).add(0.55)).mul(0.16)));
        const rim = smoothstep(0.3, 0.6, roadW).mul(float(1.0).sub(smoothstep(0.65, 0.98, roadW))).toVar();
        road.mulAssign(float(1.0).sub(rim.mul(0.18).mul(float(1.0).sub(padW.mul(1.33)))));
        const pc = floor(pp).toVar();
        const pr = hash12(pc).toVar();
        const po = pc.add(0.25).add(vec2(hash12(pc.add(17.3)), hash12(pc.add(41.7))).mul(0.5));
        const peb = float(1.0).sub(smoothstep(0.1, 0.2, T.length(pp.sub(po)))).mul(T.step(float(0.8).sub(rim.mul(0.25)), pr)).mul(pebFade);
        road.assign(mix(road, road.mul(select(fract(pr.mul(13.7)).greaterThan(0.45), float(1.32), float(0.68))), peb.mul(0.7)));
        col.assign(mix(col, road, roadW));
      });
    });
    // underwater tint + caustics
    const depth = wpos.y.negate().toVar();
    If(depth.greaterThan(0.0), () => {
      const k = clamp(depth.div(6.0), 0.0, 1.0).toVar();
      col.assign(mix(col, col.mul(vec3(0.35, 0.75, 0.8)), smoothstep(0.0, 1.0, k)));
      const t = uTime.mul(1.2).toVar();
      const p = xz.mul(0.9).toVar();
      let c: any = float(0);
      for (let i = 0; i < 3; i++) {
        const q = p.mul(1.0 + i * 0.6).add(vec2(t.mul(0.3 * (i + 1)), t.mul(-0.2))).toVar();
        c = c.add(abs(sin(q.x.mul(2.1).add(sin(q.y.mul(1.7).add(t)))).mul(sin(q.y.mul(2.3).add(sin(q.x.mul(1.3).sub(t)))))));
      }
      const caustic = pow(float(1.0).sub(c.div(3.0)), 6.0);
      col.addAssign(caustic.mul(vec3(0.55, 0.75, 0.7)).mul(k.oneMinus()).mul(smoothstep(0.0, 0.4, depth)));
    });
    outGlow.assign(vec3(0.0));
    If(uOverlayOn.greaterThan(0.5), () => {
      // bold, readable overlay: the ground goes grey and dim, the tint goes on nearly opaque and glows a little
      const ov = overlay.sample(xz.div(uMapN)).level(0).toVar();
      const lum = dot(col, vec3(0.3, 0.59, 0.11));
      col.assign(mix(vec3(lum.mul(0.45).add(0.04)), ov.rgb, clamp(ov.a.mul(0.95), 0.0, 1.0)));
      outGlow.assign(ov.rgb.mul(ov.a).mul(0.32));
    });
    diffuseColor.rgb.mulAssign(col);
    // normals: blend the layers' maps, then a world-aligned tangent frame (terrain uv = world xz)
    const tn = vec3(0.0).toVar();
    const nm = (k: string, s: number) => AT(nrm[k], s).xyz.mul(2.0).sub(1.0);
    If(w.x.greaterThan(0.0), () => { tn.addAssign(nm('sand', 0.8).mul(w.x)); });
    If(w.y.greaterThan(0.0), () => { tn.addAssign(nm('grass', 1.0).mul(w.y)); });
    If(w.z.greaterThan(0.0), () => { tn.addAssign(nm('jungle', 1.2).mul(w.z)); });
    If(w.w.greaterThan(0.0), () => { tn.addAssign(nm('rock', 0.6).mul(w.w).mul(1.4)); });
    tn.assign(normalize(tn));
    If(dirtW.greaterThan(0.0), () => { tn.assign(normalize(mix(tn, nm('dirt', 0.9), dirtW.mul(0.9)))); });
    tn.assign(normalize(mix(tn, vec3(0.0, 0.0, 1.0), roadW.mul(0.45))));
    tn.x.mulAssign(0.9);
    tn.y.mulAssign(0.9);
    const Nw = normalize(vWNorm).toVar();
    const Tw = normalize(vec3(1.0, 0.0, 0.0).sub(Nw.mul(Nw.x))).toVar();
    const Bw = cross(Nw, Tw);
    const nw = normalize(Tw.mul(tn.x).sub(Bw.mul(tn.y)).add(Nw.mul(tn.z)));
    outNormal.assign(normalize(cameraViewMatrix.mul(vec4(nw, 0.0)).xyz));
    outRough.assign(mix(0.95, 0.55, wet.mul(w.x)));
  }, 'void');
  mat.shade = () => shade();
  mat.normalNode = outNormal;
  mat.roughnessNode = outRough;
  mat.emissiveNode = outGlow;
  return { material: mat, roads, overlay };
}

// ================================================================================================= water

/** tropical ocean (water.ts has the GLSL twin): gerstner swell, depth tint, foam, sky reflection, sun glint */
export function waterMaterial(u: Record<string, U<any>>, heightTex: THREE.Texture): THREE.Material {
  const uTime = ref(u.uTime, 'float'), uMapSize = ref(u.uMapSize, 'float');
  const uSunDir = ref(u.uSunDir, 'vec3'), uSunColor = ref(u.uSunColor, 'color');
  const uSkyTop = ref(u.uSkyTop, 'color'), uSkyHorizon = ref(u.uSkyHorizon, 'color');
  const uShallow = ref(u.uShallow, 'color'), uDeep = ref(u.uDeep, 'color'), uNight = ref(u.uNight, 'float');
  const height = texture(heightTex);
  const gerstner = (p: any, dir: [number, number], steep: number, wl: number, t: any) => {
    const k = 6.2831 / wl, c = Math.sqrt(9.8 / k);
    const len = Math.hypot(dir[0], dir[1]);
    const d = [dir[0] / len, dir[1] / len];
    const f = p.x.mul(d[0]).add(p.y.mul(d[1])).sub(t.mul(c)).mul(k).toVar();
    const a = steep / k;
    return vec3(cos(f).mul(d[0] * a), sin(f).mul(a), cos(f).mul(d[1] * a));
  };
  // the water plane is never moved (model matrix identity): object space = world space, as the GLSL assumes too
  const displaced = Fn(() => {
    const wp = positionGeometry.toVar();
    const off = gerstner(wp.xz, [1.0, 0.3], 0.08, 18.0, uTime).add(gerstner(wp.xz, [-0.4, 1.0], 0.06, 11.0, uTime)).add(gerstner(wp.xz, [0.7, -0.8], 0.05, 6.0, uTime));
    return wp.add(off.mul(0.6));
  })();
  const vWPos = varying(displaced);
  const fbm = (p0: any) => {
    let s: any = float(0), a = 0.5, p = p0;
    for (let i = 0; i < 4; i++) {
      s = s.add(vnoise(p).mul(a));
      p = p.mul(2.03);
      a *= 0.5;
    }
    return s;
  };
  // gradient of fbm, analytic (one pass instead of three finite-difference fbm evaluations)
  const fbmGrad = (p0: any) => {
    let g: any = vec2(0), a = 0.5, k = 1.0;
    let p = p0;
    for (let i = 0; i < 4; i++) {
      const ip = floor(p).toVar(), f = fract(p).toVar();
      const uu = f.mul(f).mul(f.mul(-2.0).add(3.0)).toVar(), du = f.mul(f.oneMinus()).mul(6.0);
      const A = hash12(ip).toVar(), B = hash12(ip.add(vec2(1, 0))).toVar(), C = hash12(ip.add(vec2(0, 1))).toVar(), D = hash12(ip.add(vec2(1, 1)));
      const e = A.sub(B).sub(C).add(D).toVar();
      g = g.add(du.mul(vec2(B.sub(A).add(e.mul(uu.y)), C.sub(A).add(e.mul(uu.x)))).mul(a * k));
      p = p.mul(2.03);
      k *= 2.03;
      a *= 0.5;
    }
    return g;
  };
  const colorNode = Fn(() => {
    const wpos = vWPos.toVar();
    const t = uTime.toVar();
    // terrain height under the water (the sea floor beyond the map is at -14)
    const huv = wpos.xz.add(0.5).div(uMapSize.add(1.0)).toVar();
    const inside = huv.x.greaterThanEqual(0.0).and(huv.y.greaterThanEqual(0.0)).and(huv.x.lessThanEqual(1.0)).and(huv.y.lessThanEqual(1.0));
    const th = select(inside, height.sample(huv).level(0).r, float(-14.0));
    const depth = max(0.0, wpos.y.sub(th)).toVar();
    // wave normal: directional ripples with analytic derivatives, plus fine noise
    let g: any = vec2(0.0);
    for (let i = 0; i < 7; i++) {
      const ang = i * 2.39996 + 0.3;
      const d = [Math.cos(ang), Math.sin(ang)];
      const freq = 0.6 * Math.pow(1.45, i), amp = 0.11 / Math.pow(1.35, i);
      const ph = wpos.x.mul(d[0]).add(wpos.z.mul(d[1])).mul(freq).add(t.mul(1.2 + i * 0.37));
      g = g.add(vec2(d[0], d[1]).mul(cos(ph).mul(freq * amp)));
    }
    const q = wpos.xz.mul(1.7).add(vec2(t.mul(0.25), t.mul(0.18)));
    g = g.add(fbmGrad(q).mul(0.06));
    const gg = vec2(g).toVar();
    const N = normalize(vec3(gg.x.negate(), 1.0, gg.y.negate())).toVar();
    const V = normalize(cameraPosition.sub(wpos)).toVar();
    // water colour by depth (Beer-Lambert-ish), subsurface brightening on crests facing the sun
    const dk = float(1.0).sub(exp(depth.mul(-0.45))).toVar();
    const body = mix(uShallow, uDeep, dk).toVar();
    body.addAssign(uShallow.mul(0.15).mul(max(0.0, N.x.mul(uSunDir.x).add(N.z.mul(uSunDir.z)))).mul(dk.oneMinus()));
    const R = T.reflect(V.negate(), N);
    const hz = clamp(R.y, 0.0, 1.0);
    const sky = mix(uSkyHorizon, uSkyTop, pow(hz, 0.6));
    const fres = float(0.02).add(pow(float(1.0).sub(max(dot(N, V), 0.0)), 5.0).mul(0.98));
    const col = mix(body, sky.mul(0.8), fres.mul(0.7)).toVar();
    const H = normalize(uSunDir.add(V));
    const nh = max(dot(N, H), 0.0).toVar();
    const spec = pow(nh, 600.0).mul(2.5).add(pow(nh, 80.0).mul(0.12));
    col.addAssign(uSunColor.mul(spec).mul(float(1.0).sub(uNight.mul(0.9))));
    // shoreline foam: bands moving toward shore plus noise (only evaluated inside their depth band)
    const foam = float(0.0).toVar();
    If(depth.lessThan(1.4), () => {
      const shore = float(1.0).sub(smoothstep(0.0, 1.4, depth));
      const bands = sin(depth.mul(7.0).sub(t.mul(2.2)).add(fbm(wpos.xz.mul(0.6)).mul(6.0))).mul(0.5).add(0.5);
      const foamN = fbm(wpos.xz.mul(2.5).add(t.mul(0.3))).toVar();
      foam.assign(shore.mul(smoothstep(0.45, 0.9, bands.mul(0.6).add(foamN.mul(0.6)))));
      foam.addAssign(float(1.0).sub(smoothstep(0.0, 0.25, depth)).mul(smoothstep(0.35, 0.6, foamN)));
    });
    // open-sea whitecaps
    If(depth.greaterThan(3.0), () => {
      foam.addAssign(smoothstep(0.78, 0.92, fbm(wpos.xz.mul(0.35).add(t.mul(0.05)))).mul(0.25).mul(smoothstep(3.0, 10.0, depth)));
    });
    foam.assign(clamp(foam, 0.0, 1.0));
    col.assign(mix(col, vec3(0.95, 0.97, 1.0), foam.mul(0.85)));
    col.mulAssign(mix(1.0, 0.25, uNight));
    const alpha = mix(0.55, 1.0, smoothstep(0.0, 2.5, depth)).toVar();
    alpha.assign(max(alpha, foam));
    alpha.mulAssign(smoothstep(0.0, 0.08, depth));
    return vec4(col, alpha);
  })();
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
  mat.fog = true;
  mat.positionNode = displaced;
  mat.colorNode = colorNode;
  return mat;
}

// ================================================================================================= standard materials

const SKIP = new Set(['id', 'uuid', 'type', 'version', 'onBeforeCompile', 'customProgramCacheKey', 'defines', '_listeners']);
/** the node twin of a classic material (what the renderer's own conversion does), so nodes can be added to it */
export function toNodeMaterial<M extends THREE.NodeMaterial>(base: GL.Material, into: M): M {
  for (const k in base) {
    if (SKIP.has(k) || k.startsWith('is')) continue;
    const v = (base as any)[k];
    if (typeof v === 'function') continue;
    (into as any)[k] = v && (v.isColor || v.isVector2 || v.isEuler) ? v.clone() : v;
  }
  into.name = base.name;
  return into;
}

// ================================================================================================= crowds

/**
 * Instanced GPU-skinned characters (crowd.ts has the GLSL twin). The mesh is a plain Mesh drawn `count` times: the
 * instance matrix sits in the per-instance data texture (texels 9-12) next to the animation rows and clothing colours,
 * so skinning can run before the instance transform (node instancing would run first).
 */
class CrowdNodeMaterial extends THREE.MeshStandardNodeMaterial {
  diffuseNode: any = null;
  setupDiffuseColor(): void {
    // no map/colorNode on the material: the shadow pass then draws whole silhouettes, as the WebGL depth material does
    diffuseColor.assign(this.diffuseNode);
    If(diffuseColor.a.lessThan(this.alphaTest), () => { Discard(); });
  }
}

export function crowdMaterial(o: { boneTex: THREE.DataTexture; dataTex: THREE.DataTexture; textured: boolean; map: THREE.Texture | null }): { material: THREE.Material; setData(t: THREE.DataTexture): void } {
  const dataNodes: any[] = [];
  let dataTex = o.dataTex;
  const idat = (k: number) => {
    const n = textureLoad(dataTex, ivec2(k, int(instanceIndex)));
    dataNodes.push(n);
    return n;
  };
  const boneAt = (b: any, row: any) => {
    const x = b.mul(4);
    return mat4(textureLoad(o.boneTex, ivec2(x, row)), textureLoad(o.boneTex, ivec2(x.add(1), row)), textureLoad(o.boneTex, ivec2(x.add(2), row)), textureLoad(o.boneTex, ivec2(x.add(3), row)));
  };
  const skinMat = (j: any, w: any, row: any) => boneAt(j.x, row).mul(w.x).add(boneAt(j.y, row).mul(w.y)).add(boneAt(j.z, row).mul(w.z)).add(boneAt(j.w, row).mul(w.w));
  // region colour and visibility, from the region id in the red vertex colour
  const region = () => Fn(() => {
    const anim = idat(0).toVar();
    const reg = int(floor(attribute('color').x.mul(20.0).add(0.5))).toVar();
    const rc = vec3(1.0).toVar();
    const hide = float(0.0).toVar();
    If(reg.equal(0), () => { rc.assign(idat(1).rgb); })
      .ElseIf(reg.equal(1), () => { rc.assign(idat(2).rgb); })
      .ElseIf(reg.equal(2), () => { rc.assign(idat(3).rgb); })
      .ElseIf(reg.equal(3), () => { rc.assign(o.textured ? vec3(0.16, 0.10, 0.065) : vec3(0.13, 0.09, 0.06)); })
      .ElseIf(reg.equal(4), () => { rc.assign(idat(4).rgb); })
      .ElseIf(reg.equal(5), () => { const h = idat(5).toVar(); rc.assign(h.rgb); hide.assign(h.a.oneMinus()); })
      .ElseIf(reg.equal(6), () => { rc.assign(idat(7).rgb); })
      .ElseIf(reg.equal(7), () => { rc.assign(idat(8).rgb); })
      .ElseIf(reg.equal(8), () => { rc.assign(o.textured ? vec3(1.0) : vec3(0.03)); })
      .ElseIf(reg.equal(9), () => { const h = idat(6).toVar(); rc.assign(h.rgb); hide.assign(h.a.oneMinus()); })
      .ElseIf(reg.equal(10), () => { const h = idat(4).toVar(); rc.assign(h.rgb.mul(0.85)); hide.assign(h.a.oneMinus()); })
      .ElseIf(reg.greaterThanEqual(11), () => {
        // hand props: only the one belonging to the current clip is shown
        hide.assign(select(int(anim.w.add(0.5)).equal(reg), float(0.0), float(1.0)));
        rc.assign(select(reg.equal(11), vec3(0.55, 0.56, 0.6), select(reg.equal(14), vec3(0.2, 0.2, 0.21), select(reg.equal(15), vec3(0.22, 0.14, 0.065), vec3(0.16, 0.085, 0.04)))));
      });
    return vec4(rc, hide);
  })();
  const positionNode = Fn(() => {
    const anim = idat(0).toVar();
    const sj = T.ivec4(attribute('skinIndex', 'uvec4')).toVar();
    const sw = attribute('skinWeight', 'vec4').toVar();
    const sm0 = skinMat(sj, sw, int(anim.x)).toVar();
    const sm1 = skinMat(sj, sw, int(anim.y)).toVar();
    const skinM = sm0.mul(anim.z.oneMinus()).add(sm1.mul(anim.z)).toVar();
    const inst = mat4(idat(9), idat(10), idat(11), idat(12)).toVar();
    const rh = region().toVar();
    const p = skinM.mul(vec4(positionGeometry, 1.0)).xyz.toVar();
    If(rh.w.greaterThan(0.5), () => { p.assign(vec3(0.0, 0.85, 0.0)); });
    // normals as three's GLSL instancing does them (non-uniform scale divided out before the rotation)
    const im = mat3(inst).toVar();
    const n = normalize(mat3(skinM).mul(normalGeometry)).toVar();
    const c0 = im.element(0), c1 = im.element(1), c2 = im.element(2);
    n.divAssign(vec3(dot(c0, c0), dot(c1, c1), dot(c2, c2)));
    normalLocal.assign(im.mul(n));
    return inst.mul(vec4(p, 1.0)).xyz;
  })();
  const vRC = varying(region().xyz).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.FIRST);
  const mat = new CrowdNodeMaterial({ roughness: 0.82, metalness: 0, alphaTest: o.map ? 0.5 : 0, side: o.map ? THREE.DoubleSide : THREE.FrontSide });
  mat.positionNode = positionNode;
  if (o.map) {
    // the atlas holds linear detail multipliers (x2), not colours
    const t = texture(o.map, uv());
    mat.diffuseNode = vec4(t.rgb.mul(2.0).mul(vRC), t.a);
  } else mat.diffuseNode = vec4(vRC, 1.0);
  return {
    material: mat,
    setData: (t) => {
      dataTex = t;
      for (const n of dataNodes) n.value = t;
    },
  };
}

// ================================================================================================= vegetation wind

/**
 * Tree sway (vegetation.ts has the GLSL twin, which bends the tree in its own frame before the instance transform).
 * Node instancing transforms first, so each chunk's geometry carries the instance's x and z basis columns and its sway
 * phase (aWindX = vec4(column 0, phase), aWindZ = column 2): the same bend, added after the transform.
 */
export function windMaterial(base: GL.Material, stiff: number, uTime: U<number>, uWind: U<number>): THREE.Material {
  const m = toNodeMaterial(base, new THREE.MeshStandardNodeMaterial());
  const t = ref(uTime, 'float'), wind = ref(uWind, 'float');
  m.positionNode = Fn(() => {
    const pos = positionGeometry;
    const ax = attribute('aWindX', 'vec4'), az = attribute('aWindZ', 'vec3');
    const h = max(0.0, pos.y).toVar();
    const ph = ax.w;
    const sway = sin(t.mul(1.3).add(ph)).mul(0.6).add(sin(t.mul(2.7).add(ph.mul(1.7))).mul(0.25)).mul(wind).toVar();
    const flutter = sin(t.mul(7.0).add(pos.x.mul(3.0)).add(pos.z.mul(2.0)).add(ph)).mul(0.03).mul(wind);
    const ox = sway.mul(0.05).mul(h).mul(h).div(stiff).add(flutter.mul(h));
    const oz = sway.mul(0.03).mul(h).mul(h).div(stiff);
    return positionLocal.add(ax.xyz.mul(ox)).add(az.mul(oz));
  })();
  // shadows from the unbent tree, as on WebGL (whose shadow pass draws with the plain depth material)
  (m as any).castShadowPositionNode = positionLocal;
  return m;
}

/** per-chunk geometry for the wind: a copy of the tree geometry plus the instances' wind attributes */
export function windGeometry(base: GL.BufferGeometry, matrices: GL.Matrix4[]): GL.BufferGeometry {
  const g = base.clone();
  const ax = new Float32Array(matrices.length * 4), az = new Float32Array(matrices.length * 3);
  matrices.forEach((m, i) => {
    const e = m.elements;
    ax.set([e[0], e[1], e[2], e[12] * 0.37 + e[14] * 0.23], i * 4);
    az.set([e[8], e[9], e[10]], i * 3);
  });
  g.setAttribute('aWindX', new THREE.InstancedBufferAttribute(ax, 4));
  g.setAttribute('aWindZ', new THREE.InstancedBufferAttribute(az, 3));
  return g;
}

// ================================================================================================= flags

/** flag cloth waving in the vertex shader (buildings.ts has the GLSL twin) */
export function flagMaterial(base: GL.Material, uTime: U<number>): THREE.Material {
  const m = toNodeMaterial(base, new THREE.MeshStandardNodeMaterial());
  const t = ref(uTime, 'float');
  m.positionNode = Fn(() => {
    const fx = positionGeometry.x.add(0.35).toVar();
    const w = modelWorldMatrix.element(3);
    const ph = w.x.mul(1.7).add(w.z.mul(1.3));
    return positionLocal.add(vec3(0.0, 0.0, sin(t.mul(6.0).sub(fx.mul(6.0)).add(ph)).mul(0.07).mul(fx)));
  })();
  (m as any).castShadowPositionNode = positionLocal; // shadow of the flat cloth, as on WebGL
  return m;
}

// ================================================================================================= building models

/** the baked AO map also darkens sunlit surfaces, not only ambient light (bldmodels.ts has the GLSL twin) */
class BakedAOLighting extends (THREE as any).PhysicalLightingModel {
  ambientOcclusion(builder: any): void {
    super.ambientOcclusion(builder);
    const { ambientOcclusion, reflectedLight } = builder.context;
    if (!ambientOcclusion) return;
    reflectedLight.directDiffuse.mulAssign(mix(1.0, ambientOcclusion, 0.85));
    reflectedLight.directSpecular.mulAssign(ambientOcclusion);
  }
}
class BakedAONodeMaterial extends THREE.MeshStandardNodeMaterial {
  setupLightingModel(): any {
    return new BakedAOLighting();
  }
}
export function bakedAOMaterial(base: GL.Material): THREE.Material {
  return toNodeMaterial(base, new BakedAONodeMaterial());
}

// ================================================================================================= particles

/**
 * Billboard particles (effects.ts has the GLSL twin, which draws points). WebGPU points are always one pixel, so each
 * particle is an instanced quad sized exactly as gl_PointSize would size it (`size * scale / -z` framebuffer pixels).
 */
export function particleCloud(cap: number, additive: boolean, map: GL.Texture, scale: U<number>) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', pos);
  geo.setAttribute('iColor', col);
  geo.setAttribute('iSize', size);
  geo.instanceCount = 0;
  const sc = ref(scale, 'float');
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  mat.fog = false;
  mat.userData.rawOutput = true;
  mat.vertexNode = Fn(() => {
    const mv = modelViewMatrix.mul(vec4(attribute('iPos', 'vec3'), 1.0)).toVar();
    const clip = cameraProjectionMatrix.mul(mv).toVar();
    const px = attribute('iSize', 'float').mul(sc).div(mv.z.negate());
    const half = vec2(px).div(screenSize);
    return vec4(clip.xy.add(positionGeometry.xy.mul(half).mul(clip.w)), clip.z, clip.w);
  })();
  const vC = varying(attribute('iColor', 'vec4'));
  mat.colorNode = Fn(() => {
    const a = vC.a.mul(texture(map, uv()).a).toVar();
    If(a.lessThan(0.01), () => { Discard(); });
    return vec4(vC.rgb, a);
  })();
  // particles leave the AO normal buffer alone (as WebGL's AO pass hides points)
  (mat as any).mrtNode = mrt({ normal: vec4(0.0) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, pos, col, size, setCount: (n: number) => (geo.instanceCount = n) };
}

// ================================================================================================= post: GTAO

/** GTAOPass's simplex noise texture for the denoiser (GTAOPass._generateNoise) */
function pdNoiseTexture(size = 64): THREE.DataTexture {
  const simplex = new SimplexNoise();
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size; i++)
    for (let j = 0; j < size; j++) {
      data[(i * size + j) * 4] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
      data[(i * size + j) * 4 + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
      data[(i * size + j) * 4 + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
      data[(i * size + j) * 4 + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * three's WebGL GTAOPass + PoissonDenoise (post.ts FastAO: 12 samples, radius 1.2, distance exponent 1.6, thickness 2,
 * 16-tap denoise), ported line by line: r186's GTAONode is a different algorithm. The math runs in WebGL's texture
 * convention (origin bottom left) so the noise tiles and the denoiser's rotations land on the same pixels as there;
 * render-target lookups flip back. Depth and normals come from the main scene pass (MRT) instead of a second scene
 * render, which also means cut-out leaves, skinned characters and the water swell occlude as drawn.
 */
class LegacyAONode extends (THREE.TempNode as unknown as new (type: string) => any) {
  private gtaoRT = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private pdRT = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private resolution = uniform(new THREE.Vector2());
  private gtaoMat = new THREE.NodeMaterial();
  private pdMat = new THREE.NodeMaterial();
  private quad = new THREE.QuadMesh(this.gtaoMat);
  private noise1 = generateMagicSquareNoise() as unknown as THREE.DataTexture;
  private noise2 = pdNoiseTexture();
  private state: any;
  readonly out: any;

  constructor(private depthTex: THREE.Texture, private normalTex: THREE.Texture, private camera: THREE.PerspectiveCamera, private scale: number, private samples: number, private pdSamples: number) {
    super('vec4');
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
    this.gtaoRT.texture.name = 'GTAO';
    this.pdRT.texture.name = 'GTAO.denoised';
    this.out = T.passTexture(this, this.pdRT.texture);
  }

  getTextureNode(): any {
    return this.out;
  }

  updateBefore(frame: any): void {
    const r = frame.renderer as THREE.WebGPURenderer;
    const s = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.round(s.x * this.scale)), h = Math.max(1, Math.round(s.y * this.scale));
    if (this.gtaoRT.width !== w || this.gtaoRT.height !== h) {
      this.gtaoRT.setSize(w, h);
      this.pdRT.setSize(w, h);
    }
    this.resolution.value.set(w, h);
    this.state = THREE.RendererUtils.resetRendererState(r, this.state);
    r.setClearColor(0xffffff, 1);
    this.quad.material = this.gtaoMat;
    r.setRenderTarget(this.gtaoRT);
    this.quad.render(r);
    this.quad.material = this.pdMat;
    r.setRenderTarget(this.pdRT);
    this.quad.render(r);
    THREE.RendererUtils.restoreRendererState(r, this.state);
  }

  setup(builder: any): any {
    const proj = uniform(this.camera.projectionMatrix), projInv = uniform(this.camera.projectionMatrixInverse);
    const res = this.resolution;
    const glUv = Fn(() => vec2(uv().x, uv().y.oneMinus()))().toVar();
    // render-target lookups at a WebGL-convention uv
    const rt = (tex: THREE.Texture, g: any) => texture(tex, vec2(g.x, g.y.oneMinus())).level(0);
    const depthAt = (g: any) => texture(this.depthTex, vec2(g.x, g.y.oneMinus())).level(0).x;
    const normalAt = (g: any) => rt(this.normalTex, g).rgb.mul(2.0).sub(1.0);
    const viewPos = (g: any, d: any) => T.getViewPosition(vec2(g.x, g.y.oneMinus()), d, projInv);
    const sceneUv = (p: any) => {
      const c = proj.mul(vec4(p, 1.0));
      return c.xy.div(c.w).mul(0.5).add(0.5);
    };
    const RADIUS = 1.2, DIST_EXP = 1.6, THICKNESS = 2.0;
    const DIRECTIONS = this.samples < 30 ? 3 : 5, STEPS = Math.ceil(this.samples / DIRECTIONS);
    const gtao = Fn(() => {
      const depth = depthAt(glUv).toVar();
      If(depth.greaterThanEqual(1.0), () => { Discard(); });
      const vp = viewPos(glUv, depth).toVar();
      const n = normalAt(glUv).toVar();
      const noise = texture(this.noise1, glUv.mul(res).div(vec2(5, 5))).level(0).toVar();
      const rv = noise.xyz.mul(2.0).sub(1.0);
      const tangent = normalize(vec3(rv.xy, 0.0)).toVar();
      const bitangent = vec3(tangent.y.negate(), tangent.x, 0.0).toVar();
      const viewDir = normalize(vp.negate()).toVar();
      const sdw = noise.w.mul(0.5).add(0.5).toVar();
      const ao = float(0.0).toVar();
      for (let i = 0; i < DIRECTIONS; i++) {
        const angle = (i / DIRECTIONS) * Math.PI;
        const sd = normalize(tangent.mul(Math.cos(angle)).add(bitangent.mul(Math.sin(angle)))).toVar();
        const sliceBitangent = normalize(cross(sd, viewDir)).toVar();
        const sliceTangent = cross(sliceBitangent, viewDir).toVar();
        const nis = normalize(n.sub(sliceBitangent.mul(dot(n, sliceBitangent)))).toVar();
        const ttn = cross(nis, sliceBitangent).toVar();
        const cosH = vec2(dot(viewDir, ttn), dot(viewDir, ttn.negate())).toVar();
        for (let j = 0; j < STEPS; j++) {
          const off = sd.mul(sdw.mul(RADIUS * Math.pow((j + 1) / STEPS, DIST_EXP))).toVar();
          const fall = 2 / (j + 2); // mix(1, 2 / (j + 2), distanceFallOff = 1)
          for (const side of ['x', 'y'] as const) {
            const p = side === 'x' ? vp.add(off) : vp.sub(off);
            const g = sceneUv(p).toVar();
            const vd = viewPos(g, depthAt(g)).sub(vp).toVar();
            If(abs(vd.z).lessThan(THICKNESS), () => {
              const sch = dot(viewDir, normalize(vd));
              cosH[side].addAssign(max(0.0, sch.sub(cosH[side]).mul(fall)));
            });
          }
        }
        const sinH = sqrt(vec2(1.0).sub(cosH.mul(cosH))).toVar();
        const nx = dot(nis, sliceTangent), ny = dot(nis, viewDir);
        const nxb = acos(cosH.y).sub(acos(cosH.x)).add(sinH.x.mul(cosH.x)).sub(sinH.y.mul(cosH.y)).mul(0.5);
        const nyb = float(2.0).sub(cosH.x.mul(cosH.x)).sub(cosH.y.mul(cosH.y)).mul(0.5);
        ao.addAssign(nx.mul(nxb).add(ny.mul(nyb)));
      }
      ao.assign(clamp(ao.div(DIRECTIONS), 0.0, 1.0));
      return vec4(vec3(ao), 1.0);
    });
    // Poisson denoise: 16 taps (2 rings, radius exponent 1 as GTAOPass leaves them) or 8 (exponent 2) at reduced scale
    const N = this.pdSamples, rings = 2, rexp = N === 16 ? 1 : 2;
    const disk = Array.from({ length: N }, (_, i) => [Math.cos((2 * Math.PI * rings * i) / N), Math.sin((2 * Math.PI * rings * i) / N), Math.pow(i / (N - 1), rexp)]);
    const lum = (c: any) => dot(vec3(0.2125, 0.7154, 0.0721), c);
    const pd = Fn(() => {
      const depth = depthAt(glUv).toVar();
      const n = normalAt(glUv).toVar();
      If(depth.equal(1.0).or(dot(n, n).equal(0.0)), () => { Discard(); });
      const center = rt(this.gtaoRT.texture, glUv).rgb.toVar();
      const vp = viewPos(glUv, depth).toVar();
      const nt = texture(this.noise2, glUv.mul(res).div(vec2(64, 64))).level(0).x.mul(2 * Math.PI).toVar();
      const nv = vec2(sin(nt), cos(nt)).toVar();
      const denoised = vec3(center).toVar();
      const total = float(1.0).toVar();
      const cl = lum(center).toVar();
      for (const d of disk) {
        const v = vec2(d[0], d[1]).mul(1 + d[2] * (8 - 1)).div(res);
        const off = vec2(nv.x.mul(v.x).add(nv.x.mul(v.y)), nv.y.negate().mul(v.x).add(nv.y.mul(v.y)));
        const su = glUv.add(off).toVar();
        const st = rt(this.gtaoRT.texture, su).rgb.toVar();
        const sdp = depthAt(su).toVar();
        const sn = normalAt(su);
        const vps = viewPos(su, sdp);
        const normalSim = pow(max(dot(n, sn), 0.0), 3.0);
        const lumaSim = max(float(1.0).sub(abs(lum(st).sub(cl)).div(10.0)), 0.0);
        const depthSim = max(float(1.0).sub(abs(dot(vp.sub(vps), n)).div(2.0)), 0.0);
        const w = normalSim.mul(lumaSim).mul(depthSim).toVar();
        denoised.addAssign(st.mul(w));
        total.addAssign(w);
      }
      If(total.greaterThan(0.0), () => { denoised.divAssign(total); });
      return vec4(denoised, 1.0);
    });
    const ctx = T.context(builder.getSharedContext());
    this.gtaoMat.contextNode = ctx;
    this.gtaoMat.fragmentNode = gtao();
    this.gtaoMat.needsUpdate = true;
    this.pdMat.contextNode = ctx;
    this.pdMat.fragmentNode = pd();
    this.pdMat.needsUpdate = true;
    return this.out;
  }

  dispose(): void {
    super.dispose();
    this.gtaoRT.dispose();
    this.pdRT.dispose();
    this.gtaoMat.dispose();
    this.pdMat.dispose();
    this.noise1.dispose();
    this.noise2.dispose();
  }
}

// ================================================================================================= post chain

export interface PostSettings {
  ao: boolean;
  aoScale: number;
  aoSamples: number;
  bloom: boolean;
  bloomScale: number;
  aa: 'smaa' | 'fxaa' | 'none';
}

/**
 * BloomNode with r170's blur (legacy/bloom170.ts has the WebGL pass): r186 doubled the kernel radii and set sigma to a
 * third of them, which spreads highlights into a visible halo. r170 blurs mip i with radius 3, 5, 7, 9, 11 taps,
 * sigma = radius, the taps normalised to sum to one. (r186's composite already matches r170's.)
 */
class Bloom170Node extends (BloomNode as unknown as new (...a: any[]) => any) {
  _getSeparableBlurMaterial(sharedContext: any, kernelRadius186: number): any {
    const k = Math.round(kernelRadius186 / 2); // setup() asks for 6, 10, 14, 18, 22: r170 used 3, 5, 7, 9, 11
    const c: number[] = [];
    for (let i = 0; i < k; i++) c.push((0.39894 * Math.exp((-0.5 * i * i) / (k * k))) / k);
    const sum = c[0] + 2 * c.slice(1).reduce((a, b) => a + b, 0);
    const colorTexture = texture(null);
    const weights = T.array(c.slice(1).map((x) => x / sum));
    const invSize = uniform(new THREE.Vector2());
    const direction = uniform(new THREE.Vector2(0.5, 0.5));
    const uvNode = uv();
    const blur = Fn(() => {
      const acc = colorTexture.sample(uvNode).rgb.mul(c[0] / sum).toVar();
      T.Loop({ start: int(1), end: int(k), type: 'int', condition: '<' }, ({ i }: any) => {
        const off = direction.mul(invSize).mul(float(i));
        acc.addAssign(colorTexture.sample(uvNode.add(off)).rgb.add(colorTexture.sample(uvNode.sub(off)).rgb).mul(weights.element(i.sub(1))));
      });
      return vec4(acc, 1.0);
    });
    const m: any = new THREE.NodeMaterial();
    m.contextNode = sharedContext;
    m.fragmentNode = blur();
    m.name = 'Bloom_separable170';
    m.needsUpdate = true;
    m.colorTexture = colorTexture;
    m.direction = direction;
    m.invSize = invSize;
    return m;
  }
}
const bloom = (node: any, strength: number, radius: number, threshold: number): any => new Bloom170Node(T.nodeObject(node), strength, radius, threshold);

/** bloom's bright pass with the WebGL LuminosityHighPassShader's luma weights (BloomNode uses Rec. 709) */
const highPass170 = Fn(({ input, threshold, smoothWidth }: any) => {
  const v = dot(input.rgb, vec3(0.299, 0.587, 0.114));
  return mix(vec4(0.0), input, smoothstep(threshold, threshold.add(smoothWidth), v));
});

/**
 * The post chain of world.ts (RenderPass, FastAO, ScaledBloom, OutputPass, SMAA or FXAA) as one RenderPipeline:
 * scene pass (+ AO normals) -> x AO -> + bloom -> ACES / sRGB -> SMAA | FXAA.
 */
/** the TSL SMAA node, loaded on demand like the WebGL pass (post.ts loadSMAA): only 'high' uses it */
let smaaFn: ((node: any) => any) | null = null;
let smaaLoad: Promise<unknown> | null = null;
export function loadSMAA(): Promise<unknown> {
  return (smaaLoad ??= import('three/examples/jsm/tsl/display/SMAANode.js').then((m) => (smaaFn = m.smaa)));
}
export function smaaReady(): boolean {
  return !!smaaFn;
}

export class GpuPost {
  readonly pipeline: THREE.RenderPipeline;
  private nodes: { dispose(): void }[] = [];
  private scenePass: any;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, q: PostSettings, pixelRatio: number) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = (this.scenePass = pass(scene, camera));
    this.nodes.push(scenePass);
    if (q.ao) scenePass.setMRT(mrt({ output, normal: T.packNormalToRGB(negateOnBackSide(normalViewGeometry)) }));
    let color: any = scenePass.getTextureNode('output');
    if (q.ao) {
      const normalTex = scenePass.getTexture('normal');
      normalTex.minFilter = normalTex.magFilter = THREE.NearestFilter;
      const ao = new LegacyAONode(scenePass.getTexture('depth'), normalTex, camera, q.aoScale, q.aoSamples, q.aoScale < 1 ? 8 : 16);
      this.nodes.push(ao);
      color = color.mul(vec4(mix(vec3(1.0), ao.getTextureNode().rgb, 0.85), 1.0));
    }
    if (q.bloom) {
      const b: any = bloom(color, 0.18, 0.5, 0.92);
      b.highPassFn = highPass170;
      b.setResolutionScale(0.5 * q.bloomScale);
      this.nodes.push(b);
      color = color.add(b);
    }
    let out: any = toneMapSRGB(color);
    if (q.aa === 'smaa' && smaaFn) {
      const s: any = smaaFn(out);
      this.nodes.push(s);
      out = s;
    } else if ((q.aa === 'fxaa' || q.aa === 'smaa') && pixelRatio < 1.5) {
      // (smaa: FXAA until the SMAA node has loaded and the world rebuilds the chain)
      const f: any = fxaa(out);
      this.nodes.push(f);
      out = f;
    }
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = out;
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    for (const n of this.nodes) n.dispose();
    this.pipeline.dispose();
  }
}
