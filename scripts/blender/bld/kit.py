"""Building kit for Blender: period Caribbean architecture as bevelled, box-mapped geometry.

Coordinates follow the game (three.js): x right, y up, z toward the front of the building; 1 unit = 1 tile.
They are converted to Blender's z-up on the way in, and glTF export converts back.

Every primitive is created in its own local frame (so wood grain and board courses run along the piece),
bevelled, given a box-mapped UV in that frame with a random offset, then transformed into place.
Faces carry a material index into MATS; names match the game's shared materials (src/render/kit.ts),
which the game substitutes on load. A second UV set ('AO') receives a baked ambient-occlusion map.
"""
import bpy, bmesh, math, random, os
from mathutils import Vector, Matrix, Euler

MATS = ['thatch', 'thatchDark', 'planks', 'planksDark', 'oldplanks', 'plaster', 'plasterPink', 'plasterYellow',
        'plasterBlue', 'coral', 'bamboo', 'weave', 'stone', 'stoneDark', 'tiles', 'bark', 'dirt', 'wood', 'darkwood',
        'iron', 'gold', 'brass', 'canvas', 'canvasRed', 'canvasBlue', 'canvasGreen', 'canvasPurple', 'black', 'window',
        'bone', 'rope', 'leaf', 'soil', 'red', 'water', 'sand']
# bevel widths by material (tiles): timber gets a crisp arris, stone a softer one, render barely any
BEVEL = {'planks': 0.006, 'planksDark': 0.006, 'oldplanks': 0.007, 'wood': 0.008, 'darkwood': 0.008, 'stone': 0.012,
         'stoneDark': 0.01, 'coral': 0.012, 'plaster': 0.01, 'plasterPink': 0.01, 'plasterYellow': 0.01, 'plasterBlue': 0.01,
         'iron': 0.003, 'tiles': 0.0, 'thatch': 0.0, 'thatchDark': 0.0, 'bark': 0.0, 'black': 0.0, 'window': 0.0, 'brass': 0.003}


def g2b(v):
    """game (y-up, +z front) -> blender (z-up, -y front)"""
    return Vector((v[0], -v[2], v[1]))


class Kit:
    def __init__(self, seed=1):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.stack = [Matrix.Identity(4)]
        self.r = random.Random(seed).random
        self.markers = []  # (name, game-space Vector)

    # ------------------------------------------------------------------ frames
    @property
    def top(self):
        return self.stack[-1]

    def push(self, x=0, y=0, z=0, ry=0, rx=0, rz=0):
        m = Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'YXZ').to_matrix().to_4x4()
        self.stack.append(self.top @ m)
        return self

    def pop(self):
        if len(self.stack) > 1:
            self.stack.pop()
        return self

    def face(self, f, w, d):
        """frame on a face of a w x d footprint: x along the face (seen from outside), z outward"""
        if f == 'front':
            return self.push(0, 0, d / 2, 0)
        if f == 'back':
            return self.push(0, 0, -d / 2, math.pi)
        if f == 'left':
            return self.push(-w / 2, 0, 0, -math.pi / 2)
        return self.push(w / 2, 0, 0, math.pi / 2)

    def marker(self, name, x, y, z):
        p = self.top @ Vector((x, y, z, 1))
        self.markers.append((name, Vector((p.x, p.y, p.z))))

    # ------------------------------------------------------------------ geometry
    def _commit(self, tmp, mat, local, uvscale=0.5, grain=0, bevel=None):
        """bevel, box-map in local space, transform by top@local, append to the main bmesh"""
        mi = MATS.index(mat)
        bw = BEVEL.get(mat, 0.004) if bevel is None else bevel
        if bw > 0:
            edges = [e for e in tmp.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.6]
            if edges:
                bmesh.ops.bevel(tmp, geom=edges, offset=bw, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
        uvl = tmp.loops.layers.uv.verify()
        ou, ov = self.r() * 4, self.r() * 4
        tmp.normal_update()
        for f in tmp.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                if ax == 0:
                    u, v = c.z, c.y
                elif ax == 1:
                    u, v = c.x, c.z
                else:
                    u, v = c.x, c.y
                if grain:
                    u, v = v, u
                l[uvl].uv = (u * uvscale + ou, v * uvscale + ov)
        M = self.top @ local
        # copy into main bmesh
        vmap = {}
        for v in tmp.verts:
            p = M @ v.co
            vmap[v] = self.bm.verts.new(p)
        for f in tmp.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = mi
            nf.smooth = False
            for l, nl in zip(f.loops, nf.loops):
                nl[self.uv].uv = l[uvl].uv
        tmp.free()
        return self

    def box(self, mat, w, h, d, x=0, y=0, z=0, ry=0, rx=0, rz=0, uvscale=0.5, grain=0, bevel=None, centred=False):
        """box standing on y (or centred on y)"""
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1.0)
        bmesh.ops.scale(t, vec=(w, h, d), verts=t.verts)
        if not centred:
            bmesh.ops.translate(t, vec=(0, h / 2, 0), verts=t.verts)
        local = Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'YXZ').to_matrix().to_4x4()
        return self._commit(t, mat, local, uvscale, grain, bevel)

    def cbox(self, mat, w, h, d, x=0, y=0, z=0, ry=0, rx=0, rz=0, **kw):
        return self.box(mat, w, h, d, x, y, z, ry, rx, rz, centred=True, **kw)

    def cyl(self, mat, r0, r1, h, x=0, y=0, z=0, seg=10, ry=0, rx=0, rz=0, caps=True, bevel=0.0, uvscale=0.5):
        """cylinder along local y standing on y"""
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=caps, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=h)
        # blender cones run along z; turn to y and stand on 0
        bmesh.ops.rotate(t, verts=t.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 4, 'X'))
        bmesh.ops.translate(t, vec=(0, h / 2, 0), verts=t.verts)
        uvl = t.loops.layers.uv.verify()
        local = Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'YXZ').to_matrix().to_4x4()
        # cylindrical mapping
        ou = self.r() * 4
        for f in t.faces:
            for l in f.loops:
                c = l.vert.co
                a = math.atan2(c.z, c.x)
                l[uvl].uv = (a / (2 * math.pi) * (r0 + r1) * math.pi * uvscale * 2 + ou, c.y * uvscale)
        mi = MATS.index(mat)
        M = self.top @ local
        vmap = {v: self.bm.verts.new(M @ v.co) for v in t.verts}
        for f in t.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = mi
            nf.smooth = not caps or len(f.verts) == 4
            for l, nl in zip(f.loops, nf.loops):
                nl[self.uv].uv = l[uvl].uv
        t.free()
        return self

    def beam(self, mat, a, b, w, h=None, round_=False, seg=7):
        """a timber (or pole) from a to b in the current frame"""
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        if L < 1e-4:
            return self
        h = w if h is None else h
        q = Vector((0, 1, 0)).rotation_difference(d.normalized())
        if round_:
            t = bmesh.new()
            bmesh.ops.create_cone(t, cap_ends=True, cap_tris=False, segments=seg, radius1=w / 2, radius2=w / 2, depth=L)
            bmesh.ops.rotate(t, verts=t.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 4, 'X'))
        else:
            t = bmesh.new()
            bmesh.ops.create_cube(t, size=1.0)
            bmesh.ops.scale(t, vec=(w, L, h), verts=t.verts)
        local = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
        return self._commit(t, mat, local, grain=1)

    def mesh(self, mat, verts, faces, uvscale=0.5, bevel=0.0, local=None, smooth=False):
        t = bmesh.new()
        vs = [t.verts.new(v) for v in verts]
        for f in faces:
            try:
                t.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        t.normal_update()
        self._commit(t, mat, local or Matrix.Identity(4), uvscale, 0, bevel)
        if smooth:
            pass
        return self

    def torus(self, mat, R, r, x=0, y=0, z=0, rx=0, seg=12, rseg=4):
        t = bmesh.new()
        for i in range(seg):
            for j in range(rseg):
                pass
        # build a torus ring in local xz plane
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            for j in range(rseg):
                bb = 2 * math.pi * j / rseg
                rr = R + r * math.cos(bb)
                verts.append(t.verts.new((rr * math.cos(a), r * math.sin(bb), rr * math.sin(a))))
        for i in range(seg):
            for j in range(rseg):
                a = verts[i * rseg + j]
                b = verts[((i + 1) % seg) * rseg + j]
                c = verts[((i + 1) % seg) * rseg + (j + 1) % rseg]
                d = verts[i * rseg + (j + 1) % rseg]
                t.faces.new((a, b, c, d))
        local = Matrix.Translation((x, y, z)) @ Euler((rx, 0, 0)).to_matrix().to_4x4()
        return self._commit(t, mat, local, bevel=0)

    # ------------------------------------------------------------------ output
    def finish(self, name, out_dir, ao_size=1024, ground=True, ao_samples=96, ao_dist=0.6):
        """mesh object + AO bake + GLB export; returns the object"""
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o)
        me = bpy.data.meshes.new(name)
        # compact the material indices to those used, and give the mesh its slots before conversion
        used = sorted({f.material_index for f in self.bm.faces})
        remap = {o: i for i, o in enumerate(used)}
        for f in self.bm.faces:
            f.material_index = remap[f.material_index]
        names = [MATS[i] for i in used]
        for mn in names:
            me.materials.append(bpy.data.materials.get(mn) or bpy.data.materials.new(mn))
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        # game -> blender axes
        me.transform(Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        # flat-ish shading with a weighted-normal look: auto smooth by angle
        for p in me.polygons:
            p.use_smooth = False
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
        except Exception:
            pass
        # AO uv
        ao_uv = me.uv_layers.new(name='AO')
        me.uv_layers.active = ao_uv
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
        bpy.ops.object.mode_set(mode='OBJECT')
        me.uv_layers.active = me.uv_layers['UVMap']
        # bake
        gp = None
        if ground:
            bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.002))
            gp = bpy.context.active_object
            gp.data.materials.append(bpy.data.materials.get('ground') or bpy.data.materials.new('ground'))
        img = bpy.data.images.new(name + '_ao', ao_size, ao_size, alpha=False)
        for m in me.materials:
            m.use_nodes = True
            nt = m.node_tree
            n = nt.nodes.get('AO_TARGET') or nt.nodes.new('ShaderNodeTexImage')
            n.name = 'AO_TARGET'
            n.image = img
            uvn = nt.nodes.get('AO_UV') or nt.nodes.new('ShaderNodeUVMap')
            uvn.name = 'AO_UV'
            uvn.uv_map = 'AO'
            nt.links.new(uvn.outputs[0], n.inputs[0])
            nt.nodes.active = n
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = ao_samples
        sc.world = sc.world or bpy.data.worlds.new('w')
        sc.world.light_settings.distance = ao_dist
        for o in bpy.context.scene.objects:
            o.select_set(False)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        me.uv_layers.active = me.uv_layers['AO']
        bpy.ops.object.bake(type='AO', margin=6, use_clear=True, uv_layer='AO')
        me.uv_layers.active = me.uv_layers['UVMap']
        os.makedirs(out_dir, exist_ok=True)
        img.filepath_raw = os.path.join(out_dir, name + '_ao.jpg')
        img.file_format = 'JPEG'
        sc.render.image_settings.quality = 88
        img.save()
        if gp:
            bpy.data.objects.remove(gp)
        # strip bake nodes so the exporter writes plain named materials
        for m in me.materials:
            for nn in ('AO_TARGET', 'AO_UV'):
                n = m.node_tree.nodes.get(nn)
                if n:
                    m.node_tree.nodes.remove(n)
        # markers as empties
        for mname, p in self.markers:
            e = bpy.data.objects.new(mname, None)
            e.location = g2b(p)
            bpy.context.scene.collection.objects.link(e)
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, name + '.glb'), export_format='GLB', export_texcoords=True,
                                  export_normals=True, export_materials='EXPORT', export_image_format='NONE',
                                  export_apply=True, export_yup=True, use_selection=False, export_extras=False,
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                                  export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        print(f'BUILT {name}: {tris} tris, materials {names}')
        return ob
