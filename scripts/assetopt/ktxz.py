"""KTX2 (zstd-supercompressed) lossless re-pack: every mip level re-compressed at zstd 22, texel payload unchanged.
usage: python3 ktxz.py file.ktx2...   (in place; needs `pip install zstandard`)"""
import struct,zstandard,sys
ID=b'\xabKTX 20\xbb\r\n\x1a\n'
def info(b):
    assert b[:12]==ID
    hdr=struct.unpack_from('<9I',b,12); scheme=hdr[8]; n=max(1,hdr[7])
    lv=[struct.unpack_from('<3Q',b,80+24*i) for i in range(n)]
    return hdr,scheme,lv
def recompress(b,level=22):
    hdr,scheme,lv=info(b)
    if scheme!=2: return b
    first=min(o for o,l,u in lv)
    out=bytearray(b[:first])
    order=sorted(range(len(lv)),key=lambda i:lv[i][0])
    cctx=zstandard.ZstdCompressor(level=level)
    dctx=zstandard.ZstdDecompressor()
    new={}
    for i in order:
        o,l,u=lv[i]
        raw=dctx.decompress(b[o:o+l],max_output_size=u)
        assert len(raw)==u
        c=cctx.compress(raw)
        old=b[o:o+l]
        if len(c)>=len(old): c=old  # never worse
        assert dctx.decompress(c,max_output_size=u)==raw
        new[i]=(len(out),len(c),u); out+=c
    for i,(o,l,u) in new.items(): struct.pack_into('<3Q',out,80+24*i,o,l,u)
    # end of file after last level must match original (nothing after levels normally)
    assert max(o+l for o,l,u in lv)==len(b), 'trailing data'
    return bytes(out)
def payload(b):
    hdr,scheme,lv=info(b); d=zstandard.ZstdDecompressor()
    return b[:80]+b[80+24*len(lv):min(o for o,l,u in lv)], [ (d.decompress(b[o:o+l],max_output_size=u) if scheme==2 else b[o:o+l]) for o,l,u in lv]
if __name__=='__main__':
    for f in sys.argv[1:]:
        b=open(f,'rb').read(); hdr,s,lv=info(b)
        r=recompress(b)
        assert payload(r)==payload(b)
        if len(r)<len(b): open(f,'wb').write(r)
        print(f.split('/')[-1], len(b), '->', len(r))
