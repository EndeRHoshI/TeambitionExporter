"""Generate the extension's starfield/log-export icon. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math
ROOT = Path(__file__).resolve().parent.parent
S = 4
N = 128*S
im = Image.new('RGBA',(N,N))
pixels=im.load()
for y in range(N):
 for x in range(N):
  xx=x/S; yy=y/S
  blue=math.exp(-((xx-95)**2+(yy-24)**2)/3600)
  violet=math.exp(-((xx-24)**2+(yy-110)**2)/2700)
  pixels[x,y]=(int(9+24*violet+3*blue),int(17+26*blue+8*violet),int(43+62*blue+47*violet),255)
mask=Image.new('L',(N,N));ImageDraw.Draw(mask).rounded_rectangle((0,0,N-1,N-1),radius=29*S,fill=255);im.putalpha(mask)
d=ImageDraw.Draw(im)
def pts(p):return [(round(x*S),round(y*S)) for x,y in p]
def line(p,color,width):
 p=pts(p);d.line(p,fill=color,width=round(width*S),joint='curve')
 r=width*S/2
 for x,y in (p[0],p[-1]):d.ellipse((x-r,y-r,x+r,y+r),fill=color)
def star(x,y,r,color):
 d.polygon(pts([(x,y-r),(x+r*.24,y-r*.24),(x+r,y),(x+r*.24,y+r*.24),(x,y+r),(x-r*.24,y+r*.24),(x-r,y),(x-r*.24,y-r*.24)]),fill=color)
# Sparse stars stay legible rather than becoming noise at toolbar size.
star(21,29,9,'#ffe6a0');star(104,39,6,'#91dfff')
for x,y,r,col in [(109,18,1.8,'#cdeeff'),(18,70,1.7,'#85b9ef'),(27,108,2,'#a3a9fc')]:
 d.ellipse(((x-r)*S,(y-r)*S,(x+r)*S,(y+r)*S),fill=col)
# Log document and folded corner.
d.polygon(pts([(38,24),(70,24),(88,42),(88,96),(38,96)]),fill='#182b52')
line([(38,96),(38,24),(70,24),(88,42),(88,96),(38,96)],'#eff8ff',5.8)
line([(70,25),(70,42),(87,42)],'#b8deff',4.4)
for y,length in [(53,21),(66,16),(79,11)]:line([(49,y),(49+length,y)],'#8bceff',4.4)
# Bold download arrow with a dark keyline over the page.
arrow=[(84,65),(84,102)]
chevron=[(72,90),(84,103),(97,90)]
for path in [arrow,chevron]:line(path,'#14284b',13)
for path in [arrow,chevron]:line(path,'#62eddf',7)
line([(65,108),(65,114),(104,114),(104,108)],'#62eddf',5.4)
for size in (16,24,32,48,128):
 im.resize((size,size),Image.Resampling.LANCZOS).save(ROOT/f'icon{size}.png')
# Comparison sheet with the actual small toolbar sizes and large detail view.
preview=Image.new('RGB',(760,300),'#f3f5fa');pd=ImageDraw.Draw(preview)
pd.rounded_rectangle((18,18,226,282),18,fill='#e7ecf5')
preview.paste(im.resize((160,160),Image.Resampling.LANCZOS),(42,62),im.resize((160,160),Image.Resampling.LANCZOS))
for top,bg in [(28,'#ffffff'),(162,'#20242e')]:
 pd.rounded_rectangle((246,top,742,top+110),14,fill=bg)
 for x,size in [(290,16),(388,24),(498,32),(625,48)]:
  icon=im.resize((size,size),Image.Resampling.LANCZOS);preview.paste(icon,(x,top+35),icon)
  pd.text((x,top+88),str(size)+' px',fill='#768299')
preview.save(ROOT/'icon-preview.png')
