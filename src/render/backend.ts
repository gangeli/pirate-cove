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
 * WebGPU passes this game's parity checks (same image as WebGL on every tier, see the webgpu branch notes), so it
 * is the default wherever the browser offers a hardware adapter. ?gpu=webgl|webgpu forces one.
 */
export const WEBGPU_DEFAULT = true;

export async function chooseBackend(): Promise<BackendChoice> {
  const force = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('gpu') : null;
  if (force === 'webgl') return { backend: 'webgl', reason: 'forced (?gpu=webgl)', adapter: null };
  const nav = navigator as Navigator & { gpu?: GPU };
  if (!nav.gpu) return { backend: 'webgl', reason: 'no navigator.gpu', adapter: null };
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    adapter = null;
  }
  if (!adapter) return { backend: 'webgl', reason: 'no WebGPU adapter (blocklisted or unsupported)', adapter: null };
  if (force === 'webgpu') return { backend: 'webgpu', reason: 'forced (?gpu=webgpu)', adapter };
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo & { isFallbackAdapter?: boolean } }).info;
  // a software WebGPU adapter while WebGL may still have the hardware: stay on WebGL
  if (info?.isFallbackAdapter || (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter) return { backend: 'webgl', reason: 'WebGPU adapter is a software fallback', adapter };
  if (!WEBGPU_DEFAULT) return { backend: 'webgl', reason: 'WebGL is the default', adapter };
  return { backend: 'webgpu', reason: 'WebGPU adapter available', adapter };
}
