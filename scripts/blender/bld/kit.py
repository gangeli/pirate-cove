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
        'bone', 'rope', 'leaf', 'soil', 'red', 'water', 'sand', 'terracotta', 'fire', 'flagBlack', 'crop']
# bevel widths by material (tiles): timber gets a crisp arris, stone a softer one, render barely any
BEVEL = {'planks': 0.006, 'planksDark': 0.006, 'oldplanks': 0.007, 'wood': 0.008, 'darkwood': 0.008, 'stone': 0.012,
         'stoneDark': 0.01, 'coral': 0.012, 'plaster': 0.01, 'plasterPink': 0.01, 'plasterYellow': 0.01, 'plasterBlue': 0.01,
         'iron': 0.003, 'tiles': 0.0, 'thatch': 0.0, 'thatchDark': 0.0, 'bark': 0.0, 'black': 0.0, 'window': 0.0, 'brass': 0.003}


def g2b(v):
    """game (y-up, +z front) -> blender (z-up, -y front)"""
    return Vector((v[0], -v[2], v[1]))


class Kit:
    def __init__(self, seed=1, lod=False):
        self.lod = lod  # far-LOD build: simplified forms, no bevels, coarse curves
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
    def _commit(self, tmp, mat, local, uvscale=0.5, grain=0, bevel=None, wuv=False):
        """bevel, box-map in local space, transform by top@local, append to the main bmesh"""
        mi = MATS.index(mat)
        bw = 0 if self.lod else (BEVEL.get(mat, 0.004) if bevel is None else bevel)
        if bw > 0:
            edges = [e for e in tmp.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.6]
            if edges:
                bmesh.ops.bevel(tmp, geom=edges, offset=bw, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
        uvl = tmp.loops.layers.uv.verify()
        ou, ov = (0, 0) if wuv else (self.r() * 4, self.r() * 4)
        tmp.normal_update()
        Mw = self.top @ local
        Rw = Mw.to_3x3()
        for f in tmp.faces:
            n = (Rw @ f.normal) if wuv else f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = (Mw @ l.vert.co) if wuv else l.vert.co
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

    def box(self, mat, w, h, d, x=0, y=0, z=0, ry=0, rx=0, rz=0, uvscale=0.5, grain=0, bevel=None, centred=False, wuv=False):
        """box standing on y (or centred on y)"""
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1.0)
        bmesh.ops.scale(t, vec=(w, h, d), verts=t.verts)
        if not centred:
            bmesh.ops.translate(t, vec=(0, h / 2, 0), verts=t.verts)
        local = Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'YXZ').to_matrix().to_4x4()
        return self._commit(t, mat, local, uvscale, grain, bevel, wuv)

    def cbox(self, mat, w, h, d, x=0, y=0, z=0, ry=0, rx=0, rz=0, **kw):
        return self.box(mat, w, h, d, x, y, z, ry, rx, rz, centred=True, **kw)

    def cyl(self, mat, r0, r1, h, x=0, y=0, z=0, seg=10, ry=0, rx=0, rz=0, caps=True, bevel=0.0, uvscale=0.5):
        """cylinder along local y standing on y"""
        if self.lod:
            seg = max(5, seg // 2)
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
            if self.lod:
                seg = 5
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
        if self.lod and r < 0.012:
            return self  # hoops, rings and rope turns vanish at a distance
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
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002, area_weight=0.0, scale_to_bounds=True)
        # pack tightly: thousands of small islands (tiles, stones, boards) otherwise waste most of the map
        bpy.ops.uv.select_all(action='SELECT')
        try:
            bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='CARDINAL', margin_method='FRACTION',
                                    margin=0.0015, shape_method='AABB')
        except TypeError:
            bpy.ops.uv.pack_islands(rotate=True, margin=0.0015)
        bpy.ops.object.mode_set(mode='OBJECT')
        me.uv_layers.active = me.uv_layers['UVMap']
        # bake
        gp = None
        if ground:
            bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.002))
            gp = bpy.context.active_object
            gp.data.materials.append(bpy.data.materials.get('ground') or bpy.data.materials.new('ground'))
        img = bpy.data.images.new(name + '_ao', ao_size, ao_size, alpha=False)
        img.colorspace_settings.name = 'Non-Color'  # store linear values; the game reads them as data
        # unbaked texels stay white (unoccluded), so bleeding at island edges never darkens a surface
        img.generated_color = (1.0, 1.0, 1.0, 1.0)
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
            # weathering = ambient occlusion x splash-back grime near the ground x rain streaks x mottling,
            # baked as emission so it can be multiplied over the shared textures in the game
            for nn in [x for x in nt.nodes if x.name.startswith('W_')]:
                nt.nodes.remove(nn)
            def node(kind, name):
                x = nt.nodes.new(kind)
                x.name = 'W_' + name
                return x
            ao = node('ShaderNodeAmbientOcclusion', 'ao')
            ao.samples = 16
            ao.inputs['Distance'].default_value = ao_dist
            geo = node('ShaderNodeNewGeometry', 'geo')
            sep = node('ShaderNodeSeparateXYZ', 'sep')
            nt.links.new(geo.outputs['Position'], sep.inputs[0])
            ground = node('ShaderNodeMapRange', 'ground')
            ground.inputs['From Min'].default_value = 0.0
            ground.inputs['From Max'].default_value = 0.45
            ground.inputs['To Min'].default_value = 0.55
            ground.inputs['To Max'].default_value = 1.0
            nt.links.new(sep.outputs['Z'], ground.inputs['Value'])
            streak = node('ShaderNodeTexNoise', 'streak')
            streak.inputs['Scale'].default_value = 9.0
            streak.inputs['Detail'].default_value = 3.0
            smap = node('ShaderNodeMapping', 'smap')
            smap.inputs['Scale'].default_value = (6.0, 6.0, 0.35)
            nt.links.new(geo.outputs['Position'], smap.inputs[0])
            nt.links.new(smap.outputs[0], streak.inputs['Vector'])
            sr = node('ShaderNodeMapRange', 'sr')
            sr.inputs['From Min'].default_value = 0.35
            sr.inputs['From Max'].default_value = 0.7
            sr.inputs['To Min'].default_value = 0.74
            sr.inputs['To Max'].default_value = 1.0
            nt.links.new(streak.outputs['Fac'], sr.inputs['Value'])
            mott = node('ShaderNodeTexNoise', 'mott')
            mott.inputs['Scale'].default_value = 3.0
            mott.inputs['Detail'].default_value = 6.0
            nt.links.new(geo.outputs['Position'], mott.inputs['Vector'])
            mr = node('ShaderNodeMapRange', 'mr')
            mr.inputs['From Min'].default_value = 0.3
            mr.inputs['From Max'].default_value = 0.7
            mr.inputs['To Min'].default_value = 0.82
            mr.inputs['To Max'].default_value = 1.0
            nt.links.new(mott.outputs['Fac'], mr.inputs['Value'])
            m1 = node('ShaderNodeMath', 'm1'); m1.operation = 'MULTIPLY'
            m2 = node('ShaderNodeMath', 'm2'); m2.operation = 'MULTIPLY'
            m3 = node('ShaderNodeMath', 'm3'); m3.operation = 'MULTIPLY'
            nt.links.new(ao.outputs['AO'], m1.inputs[0])
            nt.links.new(ground.outputs[0], m1.inputs[1])
            nt.links.new(m1.outputs[0], m2.inputs[0])
            nt.links.new(sr.outputs[0], m2.inputs[1])
            nt.links.new(m2.outputs[0], m3.inputs[0])
            nt.links.new(mr.outputs[0], m3.inputs[1])
            em = node('ShaderNodeEmission', 'em')
            nt.links.new(m3.outputs[0], em.inputs['Color'])
            out = node('ShaderNodeOutputMaterial', 'out')
            nt.links.new(em.outputs[0], out.inputs['Surface'])
            out.is_active_output = True
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
        bpy.ops.object.bake(type='EMIT', margin=8, use_clear=False, uv_layer='AO')
        me.uv_layers.active = me.uv_layers['UVMap']
        os.makedirs(out_dir, exist_ok=True)
        # the map is smooth: bake at full size for clean edges, ship at half size
        img.scale(max(256, ao_size // 2), max(256, ao_size // 2))
        img.filepath_raw = os.path.join(out_dir, name + '_ao.jpg')
        img.file_format = 'JPEG'
        sc.render.image_settings.quality = 82
        img.save()
        if gp:
            bpy.data.objects.remove(gp)
        # strip bake nodes so the exporter writes plain named materials
        for m in me.materials:
            for n in [x for x in m.node_tree.nodes if x.name.startswith('W_')]:
                m.node_tree.nodes.remove(n)
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
