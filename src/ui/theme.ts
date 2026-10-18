/**
 * Period UI materials painted at startup: aged parchment with foxing and scorched edges, dark oiled
 * wood grain and worn leather. Exposed as CSS variables so the stylesheet can use them as backgrounds.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296);
}

function noiseLayer(w: number, h: number, scale: number, r: () => number): Float32Array {
  // value noise, bilinear
  const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
  const grid = new Float32Array(gw * gh).map(() => r());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = x / scale, fy = y / scale;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1], c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
      out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  return out;
}

function fbm(w: number, h: number, base: number, oct: number, r: () => number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const l = noiseLayer(w, h, base / 2 ** o, r);
    for (let i = 0; i < out.length; i++) out[i] += l[i] * amp;
    tot += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function parchment(w: number, h: number, seed: number, edges: boolean, tint: [number, number, number] = [236, 218, 172]): string {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const n1 = fbm(w, h, 160, 5, r), n2 = fbm(w, h, 40, 3, r), fib = fbm(w, h, 6, 2, r);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = 0.78 + (n1[i] - 0.5) * 0.22 + (n2[i] - 0.5) * 0.08 + (fib[i] - 0.5) * 0.05;
      // foxing: small brown age spots
      const spot = Math.max(0, n2[i] - 0.72) * 2.2;
      v -= spot * 0.25;
      if (edges) {
        const ex = Math.min(x, w - 1 - x) / w, ey = Math.min(y, h - 1 - y) / h;
        const e = Math.min(ex * 1.6, ey * 2.2);
        const ragged = (n2[i] - 0.5) * 0.05;
        const burn = Math.max(0, 0.06 - e + ragged) / 0.06;
        v -= burn * burn * 0.5;
      }
      const R = tint[0] * v + 10, G = tint[1] * v - 4, B = tint[2] * v - 22;
      img.data[i * 4] = Math.max(0, Math.min(255, R));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, G));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, B - spot * 30));
      img.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  // faint tea stains (only on the big untiled sheet; rings repeat visibly on tiles)
  for (let k = 0; k < (edges ? 3 : 0); k++) {
    const x = r() * w, y = r() * h, rad = 30 + r() * 70;
    g.strokeStyle = `rgba(110,70,25,${0.06 + r() * 0.06})`;
    g.lineWidth = 2 + r() * 3;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.stroke();
  }
  return c.toDataURL('image/jpeg', 0.86);
}

function wood(w: number, h: number, seed: number, base: [number, number, number]): string {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const warp = fbm(w, h, 90, 3, r), fine = fbm(w, h, 3, 2, r);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const grain = Math.sin((y + warp[i] * 60) * 0.55 + Math.sin(x * 0.01) * 3) * 0.5 + 0.5;
      const v = 0.62 + grain * 0.22 + (fine[i] - 0.5) * 0.18 + (warp[i] - 0.5) * 0.2;
      img.data[i * 4] = base[0] * v;
      img.data[i * 4 + 1] = base[1] * v;
      img.data[i * 4 + 2] = base[2] * v;
      img.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

function leather(w: number, h: number, seed: number, base: [number, number, number] = [92, 52, 30]): string {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const n = fbm(w, h, 50, 4, r), pores = fbm(w, h, 2.5, 1, r);
  for (let i = 0; i < w * h; i++) {
    const v = 0.55 + (n[i] - 0.5) * 0.5 + (pores[i] - 0.5) * 0.18;
    img.data[i * 4] = base[0] * v;
    img.data[i * 4 + 1] = base[1] * v;
    img.data[i * 4 + 2] = base[2] * v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

function iron(w: number, h: number, seed: number, base: [number, number, number]): string {
  // hammered, slightly rusted dark metal
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const n = fbm(w, h, 70, 4, r), dents = fbm(w, h, 12, 2, r), rust = fbm(w, h, 40, 3, r);
  for (let i = 0; i < w * h; i++) {
    const v = 0.7 + (n[i] - 0.5) * 0.35 + (dents[i] - 0.5) * 0.25;
    const rs = Math.max(0, rust[i] - 0.62) * 2.5;
    img.data[i * 4] = base[0] * v + rs * 40;
    img.data[i * 4 + 1] = base[1] * v + rs * 16;
    img.data[i * 4 + 2] = base[2] * v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

export type Skin = 'timber' | 'admiralty' | 'blackflag';
export const SKINS: Record<Skin, string> = { timber: 'Timber & Parchment', admiralty: 'Admiralty Chart', blackflag: 'Black Flag' };

export function currentSkin(): Skin {
  let s: string | null = new URLSearchParams(location.search).get('skin');
  try {
    s ??= localStorage.getItem('bc_skin');
  } catch {
    /* ignore */
  }
  return s && s in SKINS ? (s as Skin) : 'timber';
}

/** Paints the UI materials for a skin and exposes them as CSS variables; the stylesheet keys palette overrides off data-skin. */
export function installTheme(skin: Skin = currentSkin()): void {
  const root = document.documentElement;
  root.dataset.skin = skin;
  const st = root.style;
  const set = (k: string, url: string) => st.setProperty(k, `url(${url})`);
  if (skin === 'admiralty') {
    // black lacquered oak, cool chart paper, navy leather
    set('--paper', parchment(512, 512, 7, false, [232, 224, 196]));
    set('--paper-big', parchment(900, 640, 11, true, [232, 224, 196]));
    set('--wood-img', wood(512, 256, 3, [34, 30, 30]));
    set('--wood-dark', wood(512, 256, 5, [24, 22, 24]));
    set('--leather-img', leather(256, 256, 9, [30, 40, 62]));
  } else if (skin === 'blackflag') {
    // blackened iron, smoke-stained bone paper, oxblood leather
    set('--paper', parchment(512, 512, 7, false, [214, 200, 170]));
    set('--paper-big', parchment(900, 640, 11, true, [214, 200, 170]));
    set('--wood-img', iron(512, 256, 3, [40, 38, 36]));
    set('--wood-dark', iron(512, 256, 5, [26, 24, 23]));
    set('--leather-img', leather(256, 256, 9, [96, 26, 20]));
  } else {
    set('--paper', parchment(512, 512, 7, false));
    set('--paper-big', parchment(900, 640, 11, true));
    set('--wood-img', wood(512, 256, 3, [74, 46, 28]));
    set('--wood-dark', wood(512, 256, 5, [44, 28, 18]));
    set('--leather-img', leather(256, 256, 9));
  }
}
