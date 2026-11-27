from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

folder = Path(__file__).resolve().parent.parent
sheet_dir = folder / "07-同屏四主题对照"
sheet_dir.mkdir(exist_ok=True)
heading = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 23)
for number in range(1, 6):
    group = next(folder.glob(f"{number:02d}-*"))
    pages = sorted(group.glob("*.png"))
    assert len(pages) == 4, group
    sheet = Image.new("RGB", (1486, 834), "#e7e3d7")
    draw = ImageDraw.Draw(sheet)
    for index, path in enumerate(pages):
        with Image.open(path) as source:
            assert source.size == (780, 1688), path
            panel = source.convert("RGB").resize((352, 762), Image.Resampling.LANCZOS)
        x = 18 + index * 366
        sheet.paste(panel, (x, 52))
        draw.text((x + 176, 25), path.stem.split("-", 1)[1], fill="#253e33", font=heading, anchor="mm")
    sheet.save(sheet_dir / (group.name + ".png"), optimize=True)
