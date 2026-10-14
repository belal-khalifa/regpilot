"""Generates the SAMPLE product document sets used for RegPilot end-to-end testing.

Everything produced here is fictional and stamped "SAMPLE - SOFTWARE TESTING ONLY". Brands,
companies, certificate numbers and addresses are invented. Run:  python3 generate.py
Needs: reportlab, Pillow.
"""
import os
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
STAMP = 'SAMPLE - SOFTWARE TESTING ONLY. NOT A REAL DOCUMENT.'

# --- EAN-13 ----------------------------------------------------------------------------------

L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']


def ean13(twelve: str) -> str:
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(twelve))
    return twelve + str((10 - total % 10) % 10)


def ean_bits(code: str) -> str:
    pattern = FIRST[int(code[0])]
    bits = '101'
    for digit, kind in zip(code[1:7], pattern):
        bits += (L if kind == 'L' else G)[int(digit)]
    bits += '01010'
    for digit in code[7:]:
        bits += R[int(digit)]
    return bits + '101'


def draw_barcode(draw, code, x, y, height, module=3):
    font = ImageFont.truetype(FONT, 26)
    bits = ean_bits(code)
    for i, bit in enumerate(bits):
        if bit == '1':
            draw.rectangle([x + i * module, y, x + (i + 1) * module - 1, y + height], fill='black')
    draw.text((x + 4, y + height + 6), f'{code[0]}  {code[1:7]}  {code[7:]}', font=font, fill='black')


# --- label artwork (PNG, so the vision path is exercised) ------------------------------------


def label_png(path, brand, product, descriptor, lines, barcodes, accent):
    img = Image.new('RGB', (1500, 1000), 'white')
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1500, 150], fill=accent)
    d.text((60, 38), brand, font=ImageFont.truetype(FONT_BOLD, 74), fill='white')
    d.text((60, 190), product, font=ImageFont.truetype(FONT_BOLD, 84), fill='black')
    d.text((60, 295), descriptor, font=ImageFont.truetype(FONT, 42), fill='#333333')
    y = 380
    for line in lines:
        d.text((60, y), line, font=ImageFont.truetype(FONT, 32), fill='#222222')
        y += 46
    bx = 60
    for caption, code in barcodes:
        d.text((bx, 640), caption, font=ImageFont.truetype(FONT_BOLD, 34), fill='black')
        draw_barcode(d, code, bx, 690, 150)
        bx += 460
    d.text((60, 940), STAMP, font=ImageFont.truetype(FONT_BOLD, 26), fill='#b00020')
    img.save(path)


# --- PDFs ------------------------------------------------------------------------------------


def stamp(c):
    c.setFont('Helvetica-Bold', 8)
    c.setFillColor(colors.HexColor('#b00020'))
    c.drawCentredString(A4[0] / 2, 12 * mm, STAMP)
    c.setFillColor(colors.black)


def formula_pdf(path, title, product, rows, notes):
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    c.setFont('Helvetica-Bold', 16)
    c.drawString(20 * mm, h - 25 * mm, title)
    c.setFont('Helvetica', 11)
    c.drawString(20 * mm, h - 34 * mm, f'Product: {product}')
    for i, note in enumerate(notes):
        c.drawString(20 * mm, h - (42 + i * 6) * mm, note)
    data = [['No.', 'INCI name', 'Function', 'Concentration (% w/w)']] + [
        [str(i + 1), name, func, f'{pct}'] for i, (name, func, pct) in enumerate(rows)
    ]
    data.append(['', 'TOTAL', '', f'{sum(float(r[2]) for r in rows):.2f}'])
    t = Table(data, colWidths=[12 * mm, 72 * mm, 48 * mm, 38 * mm])
    t.setStyle(TableStyle([
        ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 10),
        ('FONT', (0, 1), (-1, -1), 'Helvetica', 10),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eeeeee')),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.grey),
        ('ALIGN', (3, 1), (3, -1), 'RIGHT'),
    ]))
    tw, th = t.wrapOn(c, w, h)
    t.drawOn(c, 20 * mm, h - (62 + len(notes) * 6) * mm - th)
    stamp(c)
    c.save()


def certificate_pdf(path, kind, number, issuer, country, body_lines, signer):
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    c.setLineWidth(2)
    c.rect(12 * mm, 12 * mm, w - 24 * mm, h - 24 * mm)
    c.setFont('Helvetica-Bold', 20)
    c.drawCentredString(w / 2, h - 40 * mm, kind)
    c.setFont('Helvetica', 12)
    c.drawCentredString(w / 2, h - 52 * mm, f'Issued by: {issuer}, {country}')
    c.setFont('Helvetica-Bold', 13)
    c.drawCentredString(w / 2, h - 66 * mm, f'Certificate No. {number}')
    c.setFont('Helvetica', 12)
    y = h - 90 * mm
    for line in body_lines:
        c.drawString(25 * mm, y, line)
        y -= 8 * mm
    c.drawString(25 * mm, 55 * mm, f'Signed and stamped: {signer}')
    c.drawString(25 * mm, 47 * mm, 'Date of issue: 12 March 2026        Valid until: 11 March 2028')
    stamp(c)
    c.save()


def build():
    # ---- Product 1: lip gloss, made in Italy, two shades, Certificate of Free Sale ----
    d1 = os.path.join(HERE, 'lip-gloss-italy')
    os.makedirs(d1, exist_ok=True)
    bc126 = ean13('802527261234')
    bc128 = ean13('802527261235')
    label_png(
        os.path.join(d1, '1-label-artwork.png'),
        'MAISON LUMIERE', 'DOUBLE GLOSS', 'Lip Gloss',
        [
            'Net content: 4 ml / 0.13 fl.oz.      Period after opening: 12M',
            'Shade 126  and  Shade 128   (shade numbers are the manufacturer\'s own codes)',
            'Batch / Lot: printed on carton base       Made in Italy',
            'Manufactured for: Lumiere Cosmetici S.p.A., Via dei Mille 14, 20121 Milan, Italy',
            'Claims: Paraben-free. Dermatologically tested. Vegan formula.',
        ],
        [('Shade 126', bc126), ('Shade 128', bc128)],
        '#8a1c3c',
    )
    formula_pdf(
        os.path.join(d1, '2-formula-ingredients.pdf'),
        'QUALITATIVE & QUANTITATIVE FORMULA', 'DOUBLE GLOSS Lip Gloss (shades 126 and 128)',
        [
            ('Polybutene', 'Emollient', '38.00'),
            ('Hydrogenated Polyisobutene', 'Emollient', '22.00'),
            ('Caprylic/Capric Triglyceride', 'Emollient', '15.00'),
            ('Silica', 'Texture agent', '6.00'),
            ('Ethylhexyl Palmitate', 'Emollient', '5.00'),
            ('Octyldodecanol', 'Emollient', '4.00'),
            ('Mica', 'Colorant', '3.10'),
            ('CI 77891', 'Colorant', '3.00'),
            ('CI 15850', 'Colorant', '1.50'),
            ('Tocopheryl Acetate', 'Antioxidant', '1.00'),
            ('Parfum', 'Fragrance', '0.50'),
            ('CI 77491', 'Colorant', '0.50'),
            ('Phenoxyethanol', 'Preservative', '0.40'),
        ],
        ['Manufacturer: Lumiere Cosmetici S.p.A., Milan, Italy.', 'Same base formula for both shades.'],
    )
    certificate_pdf(
        os.path.join(d1, '3-certificate-of-free-sale.pdf'),
        'CERTIFICATE OF FREE SALE', 'FS-2026-004417', 'Ministry of Health (sample)', 'Italy',
        [
            'This is to certify that the cosmetic product listed below is freely sold',
            'in Italy and complies with the applicable cosmetic regulations.',
            '',
            'Product:        DOUBLE GLOSS Lip Gloss (shades 126, 128)',
            'Brand:          MAISON LUMIERE',
            'Manufacturer:   Lumiere Cosmetici S.p.A.',
            'Address:        Via dei Mille 14, 20121 Milan, Italy',
        ],
        'Dr. A. Rossi, Director (sample)',
    )

    # ---- Product 2: perfume, made in the UAE, GMP certificate ----
    d2 = os.path.join(HERE, 'perfume-uae')
    os.makedirs(d2, exist_ok=True)
    bc = ean13('629110741234')
    label_png(
        os.path.join(d2, '1-label-artwork.png'),
        'MAISON ALAMIR', 'OUD NOIR', 'Eau de Parfum',
        [
            'Net content: 100 ml e   3.4 FL.OZ.',
            'Batch No: B2609       Best before: 36 months from manufacture',
            'Made in the United Arab Emirates',
            'Manufactured by: Alamir Perfumes Industries LLC, Dubai Investment Park, Dubai, UAE',
            'Flammable. Keep away from heat and flame. Keep out of reach of children.',
        ],
        [('EAN', bc)],
        '#1d1d1f',
    )
    formula_pdf(
        os.path.join(d2, '2-formula-ingredients.pdf'),
        'QUALITATIVE & QUANTITATIVE FORMULA', 'OUD NOIR Eau de Parfum 100 ml',
        [
            ('Alcohol Denat.', 'Solvent', '78.00'),
            ('Parfum', 'Fragrance', '15.00'),
            ('Aqua', 'Solvent', '6.20'),
            ('Limonene', 'Fragrance allergen', '0.30'),
            ('Linalool', 'Fragrance allergen', '0.25'),
            ('Coumarin', 'Fragrance allergen', '0.10'),
            ('Citronellol', 'Fragrance allergen', '0.08'),
            ('Geraniol', 'Fragrance allergen', '0.05'),
            ('BHT', 'Antioxidant', '0.02'),
        ],
        ['Manufacturer: Alamir Perfumes Industries LLC, Dubai, UAE.'],
    )
    certificate_pdf(
        os.path.join(d2, '3-gmp-certificate.pdf'),
        'GOOD MANUFACTURING PRACTICE (GMP) CERTIFICATE', 'GMP-DM-2026-0192', 'Dubai Municipality (sample)', 'United Arab Emirates',
        [
            'This is to certify that the manufacturing site below operates in',
            'accordance with Good Manufacturing Practice for cosmetic products.',
            '',
            'Manufacturer:   Alamir Perfumes Industries LLC',
            'Site address:   Dubai Investment Park, Dubai, United Arab Emirates',
            'Scope:          Perfumes and fragrances (Eau de Parfum)',
        ],
        'Inspection Authority (sample)',
    )
    print('written to', HERE)


if __name__ == '__main__':
    build()
