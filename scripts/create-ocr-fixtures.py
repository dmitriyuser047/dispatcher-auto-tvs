"""Create manufactured Russian invoices for repeatable OCR checks; no user data."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
import json

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "ocr"
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path("C:/Windows/Fonts/arial.ttf")
pdfmetrics.registerFont(TTFont("OCRFixture", str(FONT)))

def lines(number="314/Т-26", total="123 456,78", include_date=True):
    return [
        "СИНТЕТИЧЕСКИЙ ДОКУМЕНТ ДЛЯ ПРОВЕРКИ",
        "Счет на оплату № " + number + (" от 14.10.2026" if include_date else ""),
        'Поставщик: ООО «ТЕСТОВЫЙ ПОСТАВЩИК»',
        "ИНН 7701234560 КПП 770101001",
        'Покупатель: ООО «ТЕСТОВЫЙ ПОКУПАТЕЛЬ»',
        "ИНН 7707654320 КПП 770701001",
        "Наименование товара / услуги    Количество    Цена    Сумма",
        "1   Доставка оборудования    1    100 000,00    100 000,00",
        "Итого: 100 000,00",
        "Всего к оплате: " + total,
        "В том числе НДС: 20 576,13",
    ]

def text_page(c, content):
    c.setFont("OCRFixture", 11)
    y = 790
    for line in content:
        c.drawString(35, y, line)
        y -= 28
    c.showPage()

def raster(content):
    im = Image.new("RGB", (1800, 2500), "white")
    draw = ImageDraw.Draw(im)
    font = ImageFont.truetype(str(FONT), 32)
    for i, line in enumerate(content):
        draw.text((70, 100+i*95), line, font=font, fill="black")
    return im

scan = raster(lines("315/Т-26", "65 432,10"))
scan.save(OUT / "synthetic-invoice.png")
scan.convert("1").save(OUT / "synthetic-monochrome.png")
c = canvas.Canvas(str(OUT / "synthetic-text.pdf"), pagesize=(595, 842))
text_page(c, lines())
c.save()
c = canvas.Canvas(str(OUT / "synthetic-mixed.pdf"), pagesize=(595, 842))
text_page(c, lines())
c.drawImage(ImageReader(scan), 0, 0, 595, 842)
c.showPage()
c.save()
c = canvas.Canvas(str(OUT / "synthetic-scan-logo.pdf"), pagesize=(595, 842))
c.drawImage(ImageReader(Image.new("RGB", (50, 50), "navy")), 30, 780, 18, 18)
c.drawImage(ImageReader(scan.convert("L")), 0, 0, 595, 842)
c.showPage()
c.save()
c = canvas.Canvas(str(OUT / "synthetic-missing-date.pdf"), pagesize=(595, 842))
text_page(c, lines(include_date=False))
c.save()
(OUT / "expected.json").write_text(json.dumps({
    "synthetic": True,
    "supplier": 'ООО «ТЕСТОВЫЙ ПОСТАВЩИК»',
    "supplierInn": "7701234560",
    "date": "14.10.2026",
    "text": {"number": "314/Т-26", "sum": 123456.78},
    "scan": {"number": "315/Т-26", "sum": 65432.10},
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(OUT)
