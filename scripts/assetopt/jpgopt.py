"""usage: python3 jpgopt.py [--gray] file.jpg...   (in place; needs jpegtran, Pillow, numpy)
Lossless JPEG shrink with jpegtran: Huffman optimisation (+ progressive when smaller), metadata dropped except ICC.
--gray drops chroma from images whose chroma is constant (R=G=B after decoding). Verifies decoded pixels are identical."""
import subprocess,sys,os,io
from PIL import Image
import numpy as np
# libjpeg-turbo's jpegtran (Ubuntu: libjpeg-turbo-progs); override with $JPEGTRAN
J=os.environ.get('JPEGTRAN','jpegtran')
def tran(data,args):
    return subprocess.run([J,*args],input=data,capture_output=True,check=True).stdout
def px(data,gray=False):
    im=Image.open(io.BytesIO(data)); im.load()
    return np.asarray(im.convert('L') if gray else im)
def opt(data,gray=False):
    base=['-copy','icc','-optimize']+(['-grayscale'] if gray else [])
    c=[tran(data,base),tran(data,base+['-progressive'])]
    best=min(c,key=len)
    if len(best)>=len(data): return data
    a=np.asarray(Image.open(io.BytesIO(data)).convert('RGB')).astype(int)
    if gray:
        assert (a[...,0]==a[...,1]).all() and (a[...,0]==a[...,2]).all(), 'not grey'
        b=np.asarray(Image.open(io.BytesIO(best)).convert('L')).astype(int)
        assert (b==a[...,0]).all(), 'gray mismatch'
    else:
        b=np.asarray(Image.open(io.BytesIO(best)).convert('RGB')).astype(int)
        assert a.shape==b.shape and (a==b).all(), 'pixel mismatch'
    im=Image.open(io.BytesIO(data)); ex=im.getexif()
    assert ex.get(0x0112,1)==1, 'exif orientation present'
    return best
if __name__=='__main__':
    gray='--gray' in sys.argv; tot0=tot1=0
    for f in [a for a in sys.argv[1:] if not a.startswith('--')]:
        d=open(f,'rb').read(); n=opt(d,gray); tot0+=len(d); tot1+=len(n)
        if n is not d: open(f,'wb').write(n)
    print(f'{tot0} -> {tot1} ({100*(1-tot1/max(tot0,1)):.1f}%)')
