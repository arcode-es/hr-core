import base64, io, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
out = sys.argv[1]
F = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
def font(size, bold=False):
    try: return ImageFont.truetype(FB if bold else F, size)
    except Exception: return ImageFont.load_default()

def site(seed, w=360, h=480):
    r = random.Random(seed)
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    horizon = 280 + r.randint(0, 30)
    for y in range(horizon):
        t = y / horizon
        d.line([(0, y), (w, y)], fill=(int(120 + 76*t), int(170 + 44*t), int(225 + 11*t)))
    for y in range(horizon, h):
        t = (y - horizon) / (h - horizon)
        d.line([(0, y), (w, y)], fill=(int(168 - 48*t), int(140 - 44*t), int(104 - 34*t)))
    bx = 60 + r.randint(0, 60); bw = 170 + r.randint(0, 50); floors = 4 + r.randint(0, 2)
    top = horizon - floors * 38
    d.rectangle([bx, top, bx + bw, horizon], fill=(98, 104, 116))
    for f in range(floors + 1):
        d.rectangle([bx, top + f*38, bx + bw, top + f*38 + 5], fill=(156, 160, 168))
    for c in range(0, bw + 1, 50):
        d.rectangle([bx + c, top, bx + c + 5, horizon], fill=(156, 160, 168))
    # grúa
    cx = bx + bw + 45
    d.rectangle([cx, top - 70, cx + 7, horizon], fill=(214, 160, 40))
    d.rectangle([bx - 30, top - 70, cx + 70, top - 63], fill=(214, 160, 40))
    d.line([(cx + 60, top - 63), (cx + 60, top + 10)], fill=(60, 60, 60), width=2)
    # vallas
    for x in range(0, w, 24):
        d.rectangle([x, horizon + 30, x + 18, horizon + 70], outline=(230, 120, 40), width=3)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    return im

def receipt(seed, title, lines, total, w=300, h=520):
    r = random.Random(seed)
    im = Image.new('RGB', (w, h), (58, 62, 72))
    d = ImageDraw.Draw(im)
    d.rectangle([24, 16, w - 24, h - 16], fill=(250, 249, 244))
    y = 34
    d.text((w // 2, y), title, font=font(17, True), fill=(20, 22, 28), anchor='mt'); y += 26
    d.text((w // 2, y), 'C/ Mayor 8 · 46001 Valencia', font=font(11), fill=(90, 94, 102), anchor='mt'); y += 16
    d.text((w // 2, y), 'NIF B98765432', font=font(11), fill=(90, 94, 102), anchor='mt'); y += 26
    d.line([(40, y), (w - 40, y)], fill=(160, 160, 160)); y += 12
    for name, amount in lines:
        d.text((40, y), name, font=font(13), fill=(40, 42, 48))
        d.text((w - 40, y), amount, font=font(13), fill=(40, 42, 48), anchor='ra'); y += 22
    y += 6; d.line([(40, y), (w - 40, y)], fill=(160, 160, 160)); y += 14
    d.text((40, y), 'TOTAL', font=font(17, True), fill=(10, 10, 14))
    d.text((w - 40, y), total, font=font(17, True), fill=(10, 10, 14), anchor='ra'); y += 34
    d.text((40, y), 'IVA 21% incluido', font=font(11), fill=(90, 94, 102)); y += 18
    d.text((40, y), 'Tarjeta ****4821', font=font(11), fill=(90, 94, 102)); y += 30
    d.text((w // 2, y), '¡Gracias por su visita!', font=font(12), fill=(60, 62, 68), anchor='mt')
    return im.rotate(r.uniform(-2.5, 2.5), resample=Image.BICUBIC, fillcolor=(58, 62, 72))

imgs = {
  'SITE_A': site(1), 'SITE_B': site(7),
  'RECEIPT_MEAL': receipt(3, 'BAR LA OBRA', [('Menú del día', '11,00'), ('Agua 50 cl', '1,50')], '12,50'),
  'RECEIPT_HARDWARE': receipt(5, 'FERRETERÍA LEVANTE', [('Discos de corte x5', '9,95'), ('Guantes nitrilo', '6,40'), ('Cinta americana', '7,55')], '23,90'),
  'RECEIPT_FUEL': receipt(9, 'ESTACIÓN SERVICIO SUR', [('Gasóleo A 36,2 l', '58,40')], '58,40'),
}
with open(out, 'w') as f:
    f.write('/* Fotos de ejemplo de la demo (JPEG), generadas una vez con un script; ver demo/assets.ts. */\n')
    for k, im in imgs.items():
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=62, optimize=True, progressive=True)
        print(k, len(buf.getvalue()))
        f.write(f"export const {k} = '{base64.b64encode(buf.getvalue()).decode()}';\n")
    f.write("\nexport const jpeg = (b64: string): Buffer => Buffer.from(b64, 'base64');\n")
