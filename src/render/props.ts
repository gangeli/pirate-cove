import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl } from './textures';
import { M, mesh, box, post } from './kit';

/** Small props: Poly Haven GLBs (normalised so their largest horizontal extent = 1) plus procedural ones. */
const GLB_PROPS = ['barrel', 'barrels', 'chest', 'crate', 'lantern', 'firepit', 'bucket', 'basket', 'table', 'stool', 'roundtable', 'bananas', 'winebarrel'];

class Props {
  private src = new Map<string, THREE.Object3D>();
  loaded = false;

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(GLB_PROPS.map(async (name) => {
      try {
        let gltf;
        for (let attempt = 0; ; attempt++) {
          try {
            gltf = await loader.loadAsync(assetUrl(`models/${name}.glb`));
            break;
          } catch (e) {
            if (attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          }
        }
        const root = gltf.scene;
        const bb = new THREE.Box3().setFromObject(root);
        const size = bb.getSize(new THREE.Vector3());
        const s = 1 / Math.max(size.x, size.z, 0.001);
        const wrap = new THREE.Group();
        root.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        wrap.add(root);
        wrap.scale.setScalar(s);
        const outer = new THREE.Group();
        outer.add(wrap);
        outer.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.src.set(name, outer);
      } catch (e) {
        console.warn('prop failed', name, e);
      }
    }));
    this.loaded = true;
  }

  /** returns a new instance scaled so its footprint is `size` tiles */
  get(name: string, size = 1): THREE.Object3D {
    const s = this.src.get(name);
    let o: THREE.Object3D;
    if (s) o = s.clone();
    else o = procedural(name);
    o.scale.multiplyScalar(size);
    return o;
  }
}

function procedural(name: string): THREE.Object3D {
  const k = M();
  const g = new THREE.Group();
  switch (name) {
    case 'shrub': {
      const m = mesh(new THREE.IcosahedronGeometry(0.45, 1), k.leaf, 0, 0.5, 0);
      m.scale.y = 1.1;
      g.add(m, post(0.12, 0.05, k.wood));
      break;
    }
    case 'bush': {
      for (let i = 0; i < 4; i++) g.add(mesh(new THREE.IcosahedronGeometry(0.3, 1), k.leaf, Math.cos(i * 1.7) * 0.2, 0.25 + (i % 2) * 0.1, Math.sin(i * 1.7) * 0.2));
      break;
    }
    case 'skull': {
      g.add(mesh(new THREE.SphereGeometry(0.5, 10, 8), k.bone, 0, 0.5, 0));
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), k.bone, 0, 0.15, 0.15));
      for (const x of [-0.18, 0.18]) g.add(mesh(new THREE.SphereGeometry(0.12, 6, 5), k.black, x, 0.5, 0.42));
      break;
    }
    case 'axe': {
      g.add(box(0.06, 0.06, 0.9, k.wood, 0, 0, 0));
      g.add(box(0.05, 0.25, 0.2, k.iron, 0, -0.1, 0.4));
      break;
    }
    case 'chicken': {
      g.add(mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc87a3a }), 0, 0.45, 0));
      g.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc87a3a }), 0, 0.85, 0.3));
      g.add(mesh(new THREE.ConeGeometry(0.08, 0.2, 4), new THREE.MeshStandardMaterial({ color: 0xa02020 }), 0, 1.05, 0.3));
      break;
    }
    case 'parrot': {
      const red = new THREE.MeshStandardMaterial({ color: 0xd02a1a, roughness: 0.6 });
      const blue = new THREE.MeshStandardMaterial({ color: 0x2a5ad0, roughness: 0.6 });
      const body = mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 8), red, 0, 0.5, 0);
      body.rotation.x = 0.3;
      g.add(body, mesh(new THREE.SphereGeometry(0.2, 8, 6), red, 0, 0.95, 0.1), mesh(new THREE.ConeGeometry(0.15, 0.6, 4), blue, 0, 0.1, -0.15));
      break;
    }
    default:
      g.add(box(0.5, 0.5, 0.5, k.oldplanks));
  }
  return g;
}

export const props = new Props();
