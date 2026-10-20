"""Lossless GLB rewrite: re-supercompress embedded KTX2 (zstd 22, identical texel payload) and optionally
move images out to shared external files (dedupe); embedded JPEGs get jpgopt.
usage: glbpack.py in.glb out.glb [--extern DIR]
  --extern ship_tex: the Dutch ships (medium, large1, large2) share one texture set; it is written once to
  <out dir>/ship_tex/dutch_ship_<slot>.ktx2 and referenced by uri (run on all three after re-exporting any)."""
import json,struct,sys,os,re,hashlib
sys.path.insert(0,os.path.dirname(__file__))
from ktxz import recompress, payload
from jpgopt import opt as jpgopt
def read(f):
    b=open(f,'rb').read(); assert b[:4]==b'glTF'
    jl=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+jl])
    o=20+jl; bl,bt=struct.unpack('<II',b[o:o+8]); assert bt==0x004E4942
    return j,b[o+8:o+8+bl]
def views(j,bin_):
    return [bin_[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']] for v in j['bufferViews']]
def remap(x,m):
    if isinstance(x,dict):
        for k,v in list(x.items()):
            if k=='bufferView' and isinstance(v,int): x[k]=m[v]
            else: remap(v,m)
    elif isinstance(x,list):
        for v in x: remap(v,m)
def write(f,j,data,keep):
    # data: list of bytes per bufferView (None = dropped)
    m={}; out=bytearray(); nv=[]
    for i,v in enumerate(j['bufferViews']):
        if data[i] is None: continue
        while len(out)%4: out.append(0)
        v=dict(v); v['byteOffset']=len(out); v['byteLength']=len(data[i]); out+=data[i]
        m[i]=len(nv); nv.append(v)
    while len(out)%4: out.append(0)
    j['bufferViews']=nv
    remap({k:v for k,v in j.items() if k!='bufferViews'},m)
    j['buffers'][0]['byteLength']=len(out)
    js=json.dumps(j,separators=(',',':')).encode()
    while len(js)%4: js+=b' '
    tot=12+8+len(js)+8+len(out)
    with open(f,'wb') as fh:
        fh.write(struct.pack('<4sII',b'glTF',2,tot)); fh.write(struct.pack('<II',len(js),0x4E4F534A)); fh.write(js)
        fh.write(struct.pack('<II',len(out),0x004E4942)); fh.write(out)
if __name__=='__main__':
    inp,out=sys.argv[1:3]; ext=None
    if len(sys.argv)>3 and sys.argv[3]=='--extern': ext=sys.argv[4]  # dir relative to the glb, e.g. ship_tex
    j,bin_=read(inp); data=views(j,bin_)
    for im in j.get('images',[]):
        bv=im.get('bufferView')
        if bv is None: continue
        if im.get('mimeType')=='image/ktx2':
            new=recompress(data[bv])
            assert payload(new)==payload(data[bv])
        elif im.get('mimeType')=='image/jpeg': new=jpgopt(data[bv])
        else: new=data[bv]
        if ext:
            slot=re.sub(r'^dutch_ship_(medium|large_0\d)_','',im['name'])
            rel=f'{ext}/dutch_ship_{slot}.ktx2'
            p=os.path.join(os.path.dirname(out),rel); os.makedirs(os.path.dirname(p),exist_ok=True)
            if os.path.exists(p):
                assert payload(open(p,'rb').read())==payload(new), 'shared texture differs: '+p
            else: open(p,'wb').write(new)
            data[bv]=None; del im['bufferView']; im['uri']=rel
        else: data[bv]=new
    write(out,j,data,None)
    print(os.path.basename(inp), os.path.getsize(inp),'->',os.path.getsize(out))
