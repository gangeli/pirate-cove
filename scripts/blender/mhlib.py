# Shared helpers for building MakeHuman-based characters headlessly.
import bpy, math, os
from mathutils import Matrix, Vector, Quaternion
import addon_utils

addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
addon_utils.enable('io_anim_bvh', default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

BVH_DIR = '/home/user/assets-src/cmu/bvh'
# CMU hand/finger joints are zero-length and noisy: keep them rigid with the forearm
NOISY = {'LeftHand', 'RightHand', 'LeftFingerBase', 'RightFingerBase', 'LeftHandFinger1', 'RightHandFinger1', 'LThumb', 'RThumb'}
FPS = 30


def make_human(macro):
    m = TargetService.get_default_macro_info_dict()
    for k, v in macro.items():
        if k == 'race':
            m['race'].update(v)
        else:
            m[k] = v
    base = HumanService.create_human(macro_detail_dict=m)
    rig = HumanService.add_builtin_rig(base, 'cmu_mb')
    return base, rig


# ------------------------------------------------------------------------------------------- retargeting
def _rest_world(arm):
    mw = arm.matrix_world
    return {b.name: (mw @ b.matrix_local).to_3x3().normalized() for b in arm.data.bones}


def load_bvh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=path, axis_forward='-Z', axis_up='Y', rotate_mode='QUATERNION', global_scale=1.0, update_scene_fps=False, update_scene_duration=False)
    src = [o for o in bpy.data.objects if o not in before][0]
    return src


def sample_source(src, frames):
    """world-space rotation of every source bone + hips world position, for each frame number"""
    out = []
    sc = bpy.context.scene
    for f in frames:
        sc.frame_set(int(f), subframe=f - int(f))
        mw = src.matrix_world
        rot = {pb.name: (mw @ pb.matrix).to_3x3().normalized() for pb in src.pose.bones}
        hips = (mw @ src.pose.bones['Hips'].matrix).translation.copy()
        out.append((rot, hips))
    return out


def retarget(src, dst, name, frames, *, loop=False, inplace=False, face=True, blend=6, edit=None, stand=None):
    """Bake an action on dst from src sampled at the given (fractional, 120 Hz) frame numbers."""
    src_rest = _rest_world(src)
    dst_rest = _rest_world(dst)
    # the rigs rest in different poses (CMU T-pose vs MakeHuman A-pose): align each bone's rest direction with
    # a minimal rotation so a source bone pointing somewhere makes the target bone point the same way
    Y = Vector((0, 1, 0))
    align_inv = {}
    for b in dst.data.bones:
        if b.name in src_rest:
            sd = src_rest[b.name] @ Y
            dd = dst_rest[b.name] @ Y
            align_inv[b.name] = sd.rotation_difference(dd).to_matrix().inverted()
    smp = sample_source(src, frames)
    # height ratio for root motion
    # source rest has the hips at the origin; standing hip height = hips above the lowest toe in the rest skeleton
    dst_hip_rest = (dst.matrix_world @ dst.data.bones['Hips'].matrix_local).translation
    mw = src.matrix_world
    hz = (mw @ src.data.bones['Hips'].head_local).z
    toe = min((mw @ src.data.bones[b].tail_local).z for b in ('LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'))
    src_stand = hz - toe
    ratio = dst_hip_rest.z / max(1e-6, src_stand)
    # heading: average facing of the hips over the clip, so the character faces -Y (MakeHuman front)
    yaw = 0.0
    if face:
        acc = Vector((0, 0))
        for rot, _ in smp:
            d = rot['Hips'] @ src_rest['Hips'].inverted()
            fwd = d @ Vector((0, -1, 0))
            acc += Vector((fwd.x, fwd.y))
        yaw = math.atan2(acc.x, -acc.y)  # rotation from -Y to the facing direction
    R = Matrix.Rotation(-yaw, 3, 'Z')
    stand_z = src_stand if stand is None else stand
    # root translation trend (removed for in-place loops)
    p0 = smp[0][1]
    p1 = smp[-1][1]
    n = len(smp)
    act = bpy.data.actions.new(name)
    dst.animation_data_create()
    dst.animation_data.action = act
    bones = [b for b in dst.data.bones]  # parents first
    order = []
    seen = set()
    def visit(b):
        if b.name in seen:
            return
        if b.parent:
            visit(b.parent)
        seen.add(b.name)
        order.append(b)
    for b in bones:
        visit(b)
    dst_mw3 = dst.matrix_world.to_3x3()
    for i, (rot, hips) in enumerate(smp):
        pose_w = {}
        for b in order:
            if b.name in rot and b.name not in NOISY:
                delta = R @ rot[b.name] @ src_rest[b.name].inverted()
                pose_w[b.name] = delta @ align_inv[b.name] @ dst_rest[b.name]
            else:
                par = b.parent
                pose_w[b.name] = (pose_w[par.name] @ dst_rest[par.name].inverted() @ dst_rest[b.name]) if par else dst_rest[b.name]
        if edit:
            edit(i / max(1, n - 1), pose_w, dst_rest)
        for b in order:
            pb = dst.pose.bones[b.name]
            W = pose_w[b.name]
            if b.parent:
                Pw = pose_w[b.parent.name]
                rel_rest = dst_rest[b.parent.name].inverted() @ dst_rest[b.name]
                basis = rel_rest.inverted() @ Pw.inverted() @ W
            else:
                basis = dst_rest[b.name].inverted() @ W
            q = basis.to_quaternion()
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=i + 1)
        # root location (in bone-local space of the root bone)
        hb = dst.data.bones['Hips']
        trend = (p0.lerp(p1, i / max(1, n - 1)) if inplace else p0)
        off = R @ ((hips - trend) * ratio)
        off.z = (hips.z - stand_z) * ratio
        loc_local = (dst_mw3 @ hb.matrix_local.to_3x3()).inverted() @ off
        pbh = dst.pose.bones['Hips']
        pbh.location = loc_local
        pbh.keyframe_insert('location', frame=i + 1)
    if loop and blend > 0:
        _blend_loop(act, n, blend)
    return act


def _blend_loop(act, n, k):
    """cross-fade the last k frames toward the first frames so the cycle closes"""
    for fc in act.fcurves:
        kps = fc.keyframe_points
        vals = [kp.co[1] for kp in kps]
        for j in range(k):
            t = (j + 1) / (k + 1)
            idx = n - k + j
            target = vals[0] + (vals[-1] - vals[-2]) * 0  # first-frame value
            kps[idx].co[1] = vals[idx] * (1 - t) + vals[0] * t
        kps[n - 1].co[1] = vals[0]
        fc.update()


def best_loop(src, a, b, min_len, max_len, step=2):
    """find frame pair (i, j) in [a, b] with j-i in [min_len, max_len] whose poses match best"""
    frames = list(range(a, b + 1, step))
    smp = sample_source(src, frames)
    keys = ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftArm', 'RightArm', 'Spine1', 'LeftForeArm', 'RightForeArm']
    def d(x, y):
        s = 0.0
        for k in keys:
            q1 = x[0][k].to_quaternion()
            q2 = y[0][k].to_quaternion()
            s += 1 - abs(q1.dot(q2))
        return s
    best = (1e9, a, a + min_len)
    for ii, fi in enumerate(frames):
        for jj in range(ii + 1, len(frames)):
            fj = frames[jj]
            L = fj - fi
            if L < min_len or L > max_len:
                continue
            v = d(smp[ii], smp[jj])
            if v < best[0]:
                best = (v, fi, fj)
    return best


# ------------------------------------------------------------------------------------------- clip set
import json  # noqa: E402

# name: (bvh take, (a, b) search window or None for the whole take, options)
CLIPS = {
    'idle': ('77_02', (1, 938), dict(lmin=180, lmax=360)),
    'walk': ('07_01', (1, 317), dict(lmin=100, lmax=150, inplace=True)),
    'run': ('09_02', None, dict(lmin=70, lmax=100, inplace=True)),
    'carry': ('70_03', (700, 1854), dict(lmin=110, lmax=160, inplace=True)),
    'farm': ('13_23', (400, 3600), dict(lmin=180, lmax=320)),
    'drink': ('13_09', (100, 1103), dict(lmin=300, lmax=700)),
    'fight': ('02_07', (200, 2200), dict(lmin=150, lmax=300)),
    'talk': ('18_08', (100, 2087), dict(lmin=300, lmax=600)),
    'dance': ('141_12', None, dict(lmin=180, lmax=400)),
    'sit': ('82_05', (200, 2248), dict(lmin=300, lmax=700)),
    'limp': ('77_19', None, dict(lmin=100, lmax=200, inplace=True)),
    'swagger': ('17_06', (300, 6100), dict(lmin=100, lmax=160, inplace=True)),
    'march': ('21_06', None, dict(lmin=100, lmax=160, inplace=True)),
}
LOOP_CACHE = '/home/user/pirate-cove/scripts/blender/clip_loops.json'


def _push(rig, act):
    act.use_fake_user = True
    tr = rig.animation_data.nla_tracks.new()
    tr.name = act.name
    tr.strips.new(act.name, 1, act)
    rig.animation_data.action = None


def _swing_edit(t, pw, rest):
    """chop / hammer: arm angle about the lateral (X) axis, 0 hanging, -90 forward, -200 raised behind the head"""
    if t < 0.5:
        k = 0.5 - 0.5 * math.cos(t / 0.5 * math.pi)
        ang, bend = -60 - 140 * k, 20 + 70 * k
    elif t < 0.66:
        k = (t - 0.5) / 0.16
        ang, bend = -200 + 140 * k * k, 90 - 75 * k
    else:
        k = (t - 0.66) / 0.34
        ang, bend = -60, 15 + 5 * k
    lean = 14 * (1 - abs(ang + 60) / 140) - 4
    Rs = Matrix.Rotation(math.radians(lean), 3, 'X')
    for b in ('Spine', 'Spine1', 'Neck', 'Neck1', 'Head'):
        if b in pw:
            pw[b] = Rs @ pw[b]
    Rw = Matrix.Rotation(math.radians(ang), 3, 'X')
    Rb = Matrix.Rotation(math.radians(-bend), 3, 'X')
    for side, sx in (('Left', 1), ('Right', -1)):
        arm = side + 'Arm'
        d = rest[arm] @ Vector((0, 1, 0))
        Rin = d.rotation_difference(Vector((sx * 0.16, 0.0, -1)).normalized()).to_matrix()
        pw[arm] = Rs @ Rw @ Rin @ rest[arm]
        fore = side + 'ForeArm'
        pw[fore] = Rs @ Rw @ Rb @ Rin @ rest[fore]
        for hb in (side + 'Hand', side + 'FingerBase', side + 'HandFinger1', ('LThumb' if side == 'Left' else 'RThumb')):
            if hb in pw:
                pw[hb] = pw[fore] @ rest[fore].inverted() @ rest[hb]


def _cheer_edit(t, pw, rest):
    """both fists pumping in the air, out of step"""
    for side, sx, ph in (('Left', 1, 0.0), ('Right', -1, 0.5)):
        k = 0.5 + 0.5 * math.sin(2 * math.pi * (2 * t + ph))
        arm = side + 'Arm'
        d = rest[arm] @ Vector((0, 1, 0))
        Rin = d.rotation_difference(Vector((sx * 0.3, 0.0, -1)).normalized()).to_matrix()
        Rw = Matrix.Rotation(math.radians(-150 - 20 * k), 3, 'X') @ Matrix.Rotation(math.radians(sx * -15), 3, 'Y')
        Rb = Matrix.Rotation(math.radians(-(25 + 55 * (1 - k))), 3, 'X')
        pw[arm] = Rw @ Rin @ rest[arm]
        fore = side + 'ForeArm'
        pw[fore] = Rw @ Rb @ Rin @ rest[fore]
        for hb in (side + 'Hand', side + 'FingerBase', side + 'HandFinger1', ('LThumb' if side == 'Left' else 'RThumb')):
            if hb in pw:
                pw[hb] = pw[fore] @ rest[fore].inverted() @ rest[hb]


def bake_all_clips(rig, only=None):
    want = only.split(',') if only else None
    loops = json.load(open(LOOP_CACHE)) if os.path.exists(LOOP_CACHE) else {}
    rig.animation_data_create()
    for name, (bvh, win, opt) in CLIPS.items():
        if want and name not in want:
            continue
        src = load_bvh(os.path.join(BVH_DIR, bvh + '.bvh'))
        a0, b0 = [int(x) for x in src.animation_data.action.frame_range]
        a, b = win if win else (a0, b0)
        b = min(b, b0)
        key = f'{bvh}:{a}:{b}:{opt.get("lmin")}:{opt.get("lmax")}'
        if key not in loops:
            v, la, lb = best_loop(src, a, b, opt['lmin'], opt['lmax'], step=3)
            loops[key] = [la, lb, v]
            json.dump(loops, open(LOOP_CACHE, 'w'), indent=1)
        la, lb, v = loops[key]
        frames = list(range(la, lb + 1, 4))
        _push(rig, retarget(src, rig, name, frames, loop=True, inplace=opt.get('inplace', False)))
        print('[build] clip', name, bvh, la, lb, 'err', round(v, 4), 'frames', len(frames), flush=True)
        bpy.data.objects.remove(src)
    if not want or 'swing' in want:
        src = load_bvh(os.path.join(BVH_DIR, '77_02.bvh'))
        _push(rig, retarget(src, rig, 'swing', [200 + i * 0.5 for i in range(36)], loop=True, edit=_swing_edit))
        bpy.data.objects.remove(src)
    if not want or 'cheer' in want:
        src = load_bvh(os.path.join(BVH_DIR, '77_02.bvh'))
        _push(rig, retarget(src, rig, 'cheer', [300 + i * 0.5 for i in range(30)], loop=True, edit=_cheer_edit))
        bpy.data.objects.remove(src)
    if not want or 'die' in want or 'sleep' in want:
        # lying on his back, and the get-up of 77_18 played backwards as a collapse
        src = load_bvh(os.path.join(BVH_DIR, '77_18.bvh'))
        _push(rig, retarget(src, rig, 'sleep', list(range(40, 130, 3)), loop=True))
        _push(rig, retarget(src, rig, 'die', list(range(600, 60, -12)) + [60] * 6, loop=False))
        bpy.data.objects.remove(src)


def export_glb(rig, body, out):
    for o in list(bpy.data.objects):
        if o.type == 'ARMATURE' and o != rig:
            bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = rig
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animation_mode='NLA_TRACKS', export_skins=True,
                              export_all_influences=False, export_vertex_color='ACTIVE', export_attributes=True, export_yup=True,
                              export_frame_step=1, export_image_format='WEBP', export_image_quality=88)
