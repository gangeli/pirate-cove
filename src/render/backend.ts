import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

/**
 * Which renderer draws the world. 'webgpu' is three's WebGPURenderer with node (TSL) materials and post chain
 * (src/render/nodes.ts, loaded on demand); 'webgl' is the WebGLRenderer with the GLSL materials and EffectComposer.
 * Both draw the same image; the views build their custom materials for whichever is active (see `gpu()`).
 */
export type Backend = 'webgpu' | 'webgl';
export type AnyRenderer = THREE.WebGLRenderer | WebGPURenderer;
export type NodesModule = typeof import('./nodes');

export const RB: { backend: Backend; nodes: NodesModule | null } = { backend: 'webgl', nodes: null };

/** the node-material module when the WebGPU renderer is active, else null (views then build GLSL materials) */
export function gpu(): NodesModule | null {
  return RB.nodes;
}

export function isWebGPU(r: AnyRenderer): r is WebGPURenderer {
  return (r as WebGPURenderer).isWebGPURenderer === true;
}

export interface BackendChoice {
  backend: Backend;
  /** why this backend (shown in the profiler report) */
  reason: string;
  adapter: GPUAdapter | null;
}

/**
 * WebGPU is opt-in for now (Settings › WebGPU renderer, or ?gpu=webgpu): low and medium match WebGL exactly, but 'high'
 * still has an intermittent fault (a building group drawn nearly unlit) under investigation. Flip this to make it the
 * default wherever the browser offers a hardware adapter. ?gpu=webgl|webgpu forces one either way.
 */
export const WEBGPU_DEFAULT = false;

const PREF_KEY = 'bc.renderer';
/** the player's renderer choice from Settings ('webgpu'), or null for the default */
function backendPreference(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}
/** remember the renderer choice and reload so it takes effect (a canvas can't switch context types) */
export function setBackendPreference(v: 'webgpu' | null): void {
  try {
    if (v) localStorage.setItem(PREF_KEY, v);
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* private mode: the URL parameter still works */
  }
  const u = new URL(location.href);
  u.searchParams.delete('gpu');
  location.replace(u.toString());
}

/** CPU rasterisers, by renderer / adapter name */
export const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|gdi generic|mesa offscreen/i;

export async function chooseBackend(): Promise<BackendChoice> {
  const force = (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('gpu') : null) ?? backendPreference();
  if (force === 'webgl') return { backend: 'webgl', reason: 'forced (?gpu=webgl)', adapter: null };
  // WebGPU is opt-in: unless it was asked for, don't even probe for an adapter (that costs start-up time and logs warnings)
  if (force !== 'webgpu' && !WEBGPU_DEFAULT) return { backend: 'webgl', reason: 'WebGL is the default', adapter: null };
  const nav = navigator as Navigator & { gpu?: GPU };
  if (!nav.gpu) return { backend: 'webgl', reason: 'no navigator.gpu', adapter: null };
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    adapter = null;
  }
  if (!adapter) return { backend: 'webgl', reason: 'no WebGPU adapter (blocklisted or unsupported)', adapter: null };
  if (force === 'webgpu') return { backend: 'webgpu', reason: new URLSearchParams(location.search).has('gpu') ? 'forced (?gpu=webgpu)' : 'chosen in Settings', adapter };
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo & { isFallbackAdapter?: boolean } }).info;
  // a software WebGPU adapter (the browser's fallback flag, or a CPU rasteriser by name): stay on WebGL, which may
  // still have the hardware, and otherwise shows the software-GPU notice
  const name = info ? `${info.vendor} ${info.architecture} ${info.device} ${info.description}` : '';
  if (info?.isFallbackAdapter || (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter) return { backend: 'webgl', reason: 'WebGPU adapter is a software fallback', adapter };
  if (SOFTWARE_GPU.test(name)) return { backend: 'webgl', reason: `WebGPU adapter is a software rasteriser (${name.trim()})`, adapter };
  if (!WEBGPU_DEFAULT) return { backend: 'webgl', reason: 'WebGL is the default', adapter };
  return { backend: 'webgpu', reason: 'WebGPU adapter available', adapter };
}
