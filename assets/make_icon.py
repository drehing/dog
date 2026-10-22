from PIL import Image, ImageDraw, ImageFilter
import os

S = 1024
BG = (17, 19, 24, 255)
CREAM = (242, 194, 126, 255)
CREAM_DARK = (224, 168, 96, 255)
MUZZLE = (250, 224, 181, 255)
INK = (38, 28, 20, 255)
AMBER = (232, 163, 61, 255)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([16, 16, S - 16, S - 16], radius=232, fill=BG)
d.rounded_rectangle([16, 16, S - 16, S - 16], radius=232, outline=(255, 255, 255, 20), width=5)

# 暖色氛围
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([120, 60, 904, 844], fill=(232, 163, 61, 30))
glow = glow.filter(ImageFilter.GaussianBlur(120))
img.alpha_composite(glow)
d = ImageDraw.Draw(img)

# 耳朵（独立图层旋转）
def ear(flip=False):
    layer = Image.new("RGBA", (420, 520), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse([20, 20, 400, 500], fill=CREAM_DARK)
    ld.ellipse([90, 110, 330, 450], fill=(196, 132, 72, 255))
    layer = layer.rotate(24 if not flip else -24, expand=True, resample=Image.BICUBIC)
    return layer

left = ear(False)
right = ear(True)
img.alpha_composite(left, (70, 120))
img.alpha_composite(right, (S - 70 - right.width, 120))
d = ImageDraw.Draw(img)

# 头
d.ellipse([246, 250, 778, 780], fill=CREAM)
# 脸部浅色斑
d.ellipse([300, 300, 560, 660], fill=(246, 204, 142, 255))
# 口鼻
d.ellipse([336, 470, 688, 754], fill=MUZZLE)

# 眼睛
for cx in (388, 636):
    d.ellipse([cx - 40, 392, cx + 40, 472], fill=INK)
    d.ellipse([cx - 12, 408, cx + 8, 428], fill=(255, 248, 236, 235))
    d.ellipse([cx + 12, 442, cx + 24, 454], fill=(255, 248, 236, 120))

# 鼻子
d.ellipse([466, 512, 558, 584], fill=INK)
d.ellipse([488, 526, 512, 542], fill=(255, 255, 255, 90))
# 嘴
d.line([512, 584, 512, 620], fill=INK, width=13)
d.arc([430, 586, 512, 664], start=0, end=90, fill=INK, width=13)
d.arc([512, 586, 594, 664], start=90, end=180, fill=INK, width=13)

# 项圈
d.rounded_rectangle([286, 720, 738, 792], radius=36, fill=AMBER)
d.rounded_rectangle([286, 720, 738, 792], radius=36, outline=(120, 74, 20, 90), width=5)
d.ellipse([474, 742, 550, 818], fill=(255, 214, 140, 255))
d.ellipse([492, 760, 532, 800], fill=(150, 92, 28, 255))

img = img.resize((512, 512), Image.LANCZOS)
os.makedirs("assets", exist_ok=True)
img.save("assets/icon.png")
img.resize((256, 256), Image.LANCZOS).save("assets/icon-256.png")
img.resize((32, 32), Image.LANCZOS).save("assets/tray.png")
img.resize((16, 16), Image.LANCZOS).save("assets/tray-16.png")
img.save("assets/icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icons written")
