import sys, subprocess
from PIL import Image, ImageDraw, ImageFont
OUT=sys.argv[1]
W,H=1080,1350
F='/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
f=lambda n: ImageFont.truetype(F,n)
BG=(247,240,229); INK=(38,30,26); ACC=(196,90,40); SUB=(110,96,86)
def base(n):
    im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
    d.rounded_rectangle([W-170,50,W-50,115],radius=14,fill=INK); d.text((W-110,82),'PR',font=f(38),fill='white',anchor='mm')
    d.text((60,H-70),'眼科医くま',font=f(36),fill=SUB,anchor='lm'); d.text((W-60,H-70),f'{n}/6',font=f(34),fill=SUB,anchor='rm')
    return im,d
def lines(d,x,y,items,size,fill=INK,gap=1.55):
    for t in items:
        d.text((x,y),t,font=f(size),fill=fill); y+=int(size*gap)
    return y
im,d=base(1)
d.text((W//2,430),'食洗機の前、',font=f(96),fill=INK,anchor='mm')
d.text((W//2,560),'まだこすってる？',font=f(96),fill=INK,anchor='mm')
d.line([(200,650),(880,650)],fill=ACC,width=10)
d.text((W//2,770),'予洗い専用の泡スプレー、',font=f(52),fill=SUB,anchor='mm')
d.text((W//2,850),'という種類が出ています',font=f(52),fill=SUB,anchor='mm')
im.save(f'{OUT}/1.png')
im,d=base(2)
d.text((80,180),'食洗機の前のひと手間',font=f(70),fill=INK)
for i,(t,y) in enumerate([('① こする',420),('② すすぐ',650),('③ 入れる',880)]):
    d.rounded_rectangle([160,y-80,920,y+80],radius=30,fill='white',outline=INK,width=5)
    d.text((W//2,y),t,font=f(68),fill=INK,anchor='mm')
    if i<2: d.polygon([(W//2-30,y+100),(W//2+30,y+100),(W//2,y+140)],fill=ACC)
d.text((W//2,1080),'この①②を減らしたい人へ',font=f(48),fill=ACC,anchor='mm')
im.save(f'{OUT}/2.png')
im,d=base(3)
d.text((80,180),'予洗い専用の泡スプレー',font=f(70),fill=INK)
y=lines(d,80,330,['CHARMY クリスタ','予洗い専用泡スプレー（ライオン）'],58)
y=lines(d,80,y+20,['2026年9月9日発売'],46,SUB)
d.rounded_rectangle([60,y+60,W-60,y+480],radius=30,fill='white')
lines(d,110,y+110,['メーカーによると','吹きかけてから食洗機へ。','こすり洗い・すすぎは不要','とのことです。'],52)
im.save(f'{OUT}/3.png')
im,d=base(4)
d.text((80,180),'買う前に確認したいこと',font=f(70),fill=INK)
lines(d,100,360,['・スプレーしてから半日以内に','  洗う（メーカーの注意書き）','・無香料','・本体300ml／つめかえ用500ml','・価格と在庫は','  お店のページで確認'],54,gap=1.7)
im.save(f'{OUT}/4.png')
im,d=base(5)
d.text((80,180),'このまとめについて',font=f(70),fill=INK)
lines(d,100,380,['使った感想ではなく、','メーカーの公表情報で','整理しました。'],60,gap=1.6)
lines(d,100,760,['出典：ライオン ニュースリリース','（2026年）'],40,SUB)
im.save(f'{OUT}/5.png')
im,d=base(6)
d.text((W//2,420),'商品は楽天ROOMに',font=f(80),fill=INK,anchor='mm')
d.text((W//2,540),'まとめています',font=f(80),fill=INK,anchor='mm')
d.text((W//2,720),'プロフィールのリンクから',font=f(54),fill=SUB,anchor='mm')
d.text((W//2,1000),'楽天アフィリエイトを利用しています',font=f(40),fill=SUB,anchor='mm')
im.save(f'{OUT}/6.png')
