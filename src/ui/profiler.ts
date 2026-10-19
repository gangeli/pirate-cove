import type { App } from './app';
import { el, html, setHTML } from './dom';

/**
 * In-game performance recorder (Settings › Record performance, or ?profile=60). Records a minute of real play on the
 * player's own machine and produces a compact JSON report to copy or download: device and GPU, quality settings,
 * per-second frame statistics with a CPU split (sim / render / UI), GPU time where the browser exposes timer
 * queries, draw calls, memory, input latency, long frames and their script attribution, and shader compiles.
 */

type Sec = {
  t: number; frames: number; fps: number; p50: number; p95: number; max: number;
  sim: number; render: number; ui: number; gpu: number | null; calls: number; tris: number; pr: number;
  heapMB: number | null; geoms: number; tex: number; progs: number; speed: number; paused: boolean; state: string; panels: string;
};

type GpuTimer = {
  gl: WebGL2RenderingContext; ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  free: WebGLQuery[]; pending: { q: WebGLQuery; sec: number }[]; active: WebGLQuery | null;
};

const pct = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

export class Profiler {
  private t0 = performance.now();
  private secStart = this.t0;
  private frameStart = 0;
  private lapAt = 0;
  private cur = { sim: 0, render: 0, ui: 0 };
  private bucket = { iv: [] as number[], sim: 0, render: 0, ui: 0, calls: 0, tris: 0, gpu: [] as number[] };
  private lastFrame = 0;
  private seconds: Sec[] = [];
  private worst: { t: number; ms: number; sim: number; render: number; ui: number; calls: number; progs: number }[] = [];
  private inputs: number[] = [];
  private inputPending: number[] = [];
  private longFrames: { t: number; ms: number; blocking: number; scripts: string[] }[] = [];
  private compiles: { t: number; programs: number; frameMs: number }[] = [];
  private progs = 0;
  private gpuT: GpuTimer | null = null;
  private obs: PerformanceObserver | null = null;
  private badge: HTMLElement;
  private stopped = false;
  private onInput = (e: Event) => this.inputPending.push(e.timeStamp);

  constructor(private app: App, private secondsWanted = 60, private onDone?: (report: string) => void) {
    const r = app.world.renderer;
    r.info.autoReset = false; // count every pass of the post chain, not just the last
    r.info.reset();
    this.progs = r.info.programs?.length ?? 0;
    const gl = r.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (ext) this.gpuT = { gl, ext, free: [], pending: [], active: null };
    for (const ev of ['keydown', 'pointerdown', 'wheel']) window.addEventListener(ev, this.onInput, { capture: true, passive: true });
    try {
      const type = PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame') ? 'long-animation-frame' : 'longtask';
      this.obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) {
          if (this.longFrames.length >= 40) break;
          const scripts = (e.scripts ?? [])
            .sort((a: any, b: any) => b.duration - a.duration)
            .slice(0, 3)
            .map((s: any) => `${Math.round(s.duration)}ms ${s.invoker || s.invokerType || ''} ${(s.sourceFunctionName || '')} ${(s.sourceURL || '').split('/').pop()}:${s.sourceCharPosition ?? ''}`.trim());
          this.longFrames.push({ t: r1((e.startTime - this.t0) / 1000), ms: Math.round(e.duration), blocking: Math.round(e.blockingDuration ?? 0), scripts });
        }
      });
      this.obs.observe({ type, buffered: false });
    } catch {
      /* ignore */
    }
    this.badge = el('div', 'panel prof-badge', document.body);
    this.badge.style.cssText = 'position:fixed;right:12px;bottom:84px;z-index:60;padding:6px 10px;font-size:13px;pointer-events:auto;cursor:pointer';
    this.badge.title = 'Click to stop early';
    this.badge.onclick = () => this.finish();
    this.paintBadge();
  }

  private paintBadge(): void {
    const left = Math.max(0, Math.ceil(this.secondsWanted - (performance.now() - this.t0) / 1000));
    setHTML(this.badge, html`<span style="color:#e04030">&#9679;</span> Recording performance&hellip; ${left}s <span class="sub">(click to stop)</span>`);
  }

  // ------------------------------------------------------------------------------------------- frame hooks
  begin(now: number): void {
    if (this.stopped) return;
    if (this.lastFrame) this.bucket.iv.push(now - this.lastFrame);
    this.lastFrame = now;
    this.frameStart = this.lapAt = performance.now();
    this.cur.sim = this.cur.render = this.cur.ui = 0;
    this.app.world.renderer.info.reset();
    this.pollGpu();
  }

  /** time since the previous lap goes to `k`; the render lap is also timed on the GPU */
  lap(k: 'sim' | 'render' | 'ui'): void {
    if (this.stopped) return;
    const t = performance.now();
    this.cur[k] += t - this.lapAt;
    this.lapAt = t;
    if (k === 'sim') this.gpuBegin();
    else if (k === 'render') this.gpuEnd();
  }

  end(): void {
    if (this.stopped) return;
    const now = performance.now();
    const ms = now - this.frameStart;
    const info = this.app.world.renderer.info;
    const b = this.bucket;
    b.sim += this.cur.sim;
    b.render += this.cur.render;
    b.ui += this.cur.ui;
    b.calls += info.render.calls;
    b.tris += info.render.triangles;
    const progs = info.programs?.length ?? 0;
    if (progs > this.progs && this.compiles.length < 60) this.compiles.push({ t: r1((now - this.t0) / 1000), programs: progs - this.progs, frameMs: Math.round(ms) });
    this.progs = progs;
    if (this.inputPending.length) {
      for (const ts of this.inputPending) if (this.inputs.length < 400) this.inputs.push(now - ts);
      this.inputPending.length = 0;
    }
    const iv = b.iv[b.iv.length - 1] ?? 0;
    if (iv > 40) {
      this.worst.push({ t: r1((now - this.t0) / 1000), ms: Math.round(iv), sim: r1(this.cur.sim), render: r1(this.cur.render), ui: r1(this.cur.ui), calls: info.render.calls, progs: progs });
      this.worst.sort((x, y) => y.ms - x.ms);
      this.worst.length = Math.min(this.worst.length, 15);
    }
    if (now - this.secStart >= 1000) this.closeSecond(now);
    if (now - this.t0 >= this.secondsWanted * 1000) this.finish();
  }

  private closeSecond(now: number): void {
    const b = this.bucket, n = Math.max(1, b.iv.length);
    const iv = [...b.iv].sort((x, y) => x - y);
    const a = this.app, w = a.world, info = w.renderer.info;
    const mem = (performance as any).memory;
    const open = [a.build?.visible && 'build', a.edicts?.visible && 'edicts', a.log?.visible && 'log', a.chart?.visible && 'chart', a.overlays?.visible && 'overlays', a.modal?.open && 'modal', a.tool?.kind !== 'select' && `tool:${a.tool?.kind}`].filter(Boolean).join(',');
    this.seconds.push({
      t: Math.round((now - this.t0) / 1000), frames: b.iv.length, fps: r1((b.iv.length * 1000) / (now - this.secStart)),
      p50: r1(pct(iv, 0.5)), p95: r1(pct(iv, 0.95)), max: r1(iv[iv.length - 1] ?? 0),
      sim: r1(b.sim / n), render: r1(b.render / n), ui: r1(b.ui / n), gpu: b.gpu.length ? r1(b.gpu.reduce((x, y) => x + y, 0) / b.gpu.length) : null,
      calls: Math.round(b.calls / n), tris: Math.round(b.tris / n), pr: r1(w.pr * 100) / 100,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null, geoms: info.memory.geometries, tex: info.memory.textures, progs: info.programs?.length ?? 0,
      speed: a.game?.speed ?? 0, paused: !!a.game?.paused, state: a.state, panels: open,
    });
    this.bucket = { iv: [], sim: 0, render: 0, ui: 0, calls: 0, tris: 0, gpu: [] };
    this.secStart = now;
    this.paintBadge();
  }

  // ------------------------------------------------------------------------------------------- GPU timer queries
  private gpuBegin(): void {
    const g = this.gpuT;
    if (!g || g.active) return;
    const q = g.free.pop() ?? g.gl.createQuery();
    if (!q) return;
    g.gl.beginQuery(g.ext.TIME_ELAPSED_EXT, q);
    g.active = q;
  }
  private gpuEnd(): void {
    const g = this.gpuT;
    if (!g?.active) return;
    g.gl.endQuery(g.ext.TIME_ELAPSED_EXT);
    g.pending.push({ q: g.active, sec: this.seconds.length });
    g.active = null;
  }
  private pollGpu(): void {
    const g = this.gpuT;
    if (!g) return;
    const disjoint = g.gl.getParameter(g.ext.GPU_DISJOINT_EXT);
    while (g.pending.length) {
      const p = g.pending[0];
      if (!g.gl.getQueryParameter(p.q, g.gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = g.gl.getQueryParameter(p.q, g.gl.QUERY_RESULT) as number;
      if (!disjoint) this.bucket.gpu.push(ns / 1e6);
      g.pending.shift();
      g.free.push(p.q);
    }
  }

  // ------------------------------------------------------------------------------------------- report
  finish(): void {
    if (this.stopped) return;
    const now = performance.now();
    if (this.bucket.iv.length > 5) this.closeSecond(now);
    this.stopped = true;
    this.obs?.disconnect();
    for (const ev of ['keydown', 'pointerdown', 'wheel']) window.removeEventListener(ev, this.onInput, { capture: true } as EventListenerOptions);
    const g = this.gpuT;
    if (g) for (const q of [...g.free, ...g.pending.map((p) => p.q)]) g.gl.deleteQuery(q);
    this.app.world.renderer.info.autoReset = true;
    this.badge.remove();
    this.onDone?.(this.report(now));
  }

  private report(now: number): string {
    const a = this.app, w = a.world, s = this.seconds;
    const gl = w.renderer.getContext() as WebGL2RenderingContext;
    const has = (e: string) => !!gl.getSupportedExtensions()?.includes(e);
    const nav = navigator as any;
    const allIv = s.flatMap((x) => Array(x.frames).fill(x.p50)); // per-second medians weighted by frames
    const fpsAll = s.length ? r1(s.reduce((x, y) => x + y.frames, 0) / ((now - this.t0) / 1000)) : 0;
    const avg = (k: keyof Sec) => {
      const v = s.map((x) => x[k]).filter((x): x is number => typeof x === 'number');
      return v.length ? r1(v.reduce((x, y) => x + y, 0) / v.length) : null;
    };
    const inp = [...this.inputs].sort((x, y) => x - y);
    const g = a.game;
    const rep = {
      kind: 'buccaneer-cove-profile', v: 1, when: new Date().toISOString(), seconds: Math.round((now - this.t0) / 1000),
      summary: {
        fps: fpsAll, frameP50: r1(pct(allIv.sort((x, y) => x - y), 0.5)), worstSecondP95: Math.max(0, ...s.map((x) => x.p95)), slowSeconds: s.filter((x) => x.fps < 30).length,
        cpuMsPerFrame: { sim: avg('sim'), render: avg('render'), ui: avg('ui') }, gpuMsPerFrame: avg('gpu'), drawCalls: avg('calls'), triangles: avg('tris'),
        inputLatencyMs: inp.length ? { n: inp.length, p50: Math.round(pct(inp, 0.5)), p95: Math.round(pct(inp, 0.95)), max: Math.round(inp[inp.length - 1]) } : null,
        longFrames: this.longFrames.length, shaderCompiles: this.compiles.reduce((x, y) => x + y.programs, 0),
      },
      device: {
        ua: navigator.userAgent, platform: nav.userAgentData?.platform ?? navigator.platform, mobile: nav.userAgentData?.mobile ?? null,
        cores: navigator.hardwareConcurrency, memoryGB: nav.deviceMemory ?? null, dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`,
        viewport: `${innerWidth}x${innerHeight}`, touch: navigator.maxTouchPoints, standalone: matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches,
        gpu: w.gpu, webgl: { maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), timerQuery: !!this.gpuT, parallelCompile: has('KHR_parallel_shader_compile'), astc: has('WEBGL_compressed_texture_astc'), bc7: has('EXT_texture_compression_bptc'), etc: has('WEBGL_compressed_texture_etc') },
      },
      quality: { tier: a.quality, pixelRatio: w.pr, canvas: `${w.renderer.domElement.width}x${w.renderer.domElement.height}`, settings: w.quality },
      game: g ? { date: g.date, people: g.people.size, buildings: g.buildings.size, ships: g.ships?.size ?? null, speed: g.speed, mapSize: g.map.size } : null,
      perSecond: s,
      worstFrames: this.worst,
      longFrames: this.longFrames,
      shaderCompiles: this.compiles,
    };
    return JSON.stringify(rep);
  }
}

/** start a recording and show the report when it ends */
export function recordProfile(app: App, seconds = 60): void {
  if (app.prof) return;
  app.prof = new Profiler(app, seconds, (report) => {
    app.prof = undefined;
    showReport(report);
  });
}

function showReport(report: string): void {
  const box = el('div', 'panel prof-report', document.body);
  box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:70;width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 64px);display:flex;flex-direction:column;gap:8px';
  const sum = JSON.parse(report).summary;
  const kb = (report.length / 1024).toFixed(1);
  setHTML(box, html`<h3 style="margin:0">Performance report</h3>
    <div class="sub">${sum.fps} fps average &middot; GPU ${sum.gpuMsPerFrame ?? 'n/a'} ms/frame &middot; ${sum.drawCalls} draw calls &middot; ${kb} KB. Copy it and paste it into the chat, or save the file.</div>
    <textarea readonly style="flex:1;min-height:160px;font:11px/1.3 ui-monospace,monospace;width:100%;box-sizing:border-box;background:#f6efdc;color:#2a1a0c;border:1px solid #8a6a3a">${report}</textarea>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn small" data-k="copy">Copy</button><button class="btn small" data-k="save">Save file</button><button class="btn small green" data-k="close">Close</button></div>`);
  const ta = box.querySelector('textarea')!;
  const btn = (k: string) => box.querySelector<HTMLButtonElement>(`[data-k="${k}"]`)!;
  btn('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      ta.select();
      document.execCommand('copy');
    }
    btn('copy').textContent = 'Copied';
  };
  btn('save').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([report], { type: 'application/json' }));
    a.download = `buccaneer-cove-profile-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  btn('close').onclick = () => box.remove();
}
