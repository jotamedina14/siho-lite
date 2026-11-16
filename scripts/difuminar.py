"""Crea copias de las capturas con datos personales difuminados (número de cuenta de AWS e IP pública).

Usa OCR (RapidOCR) para encontrar cada línea de texto que contenga los valores y pixela esa zona.
Después vuelve a pasar el OCR sobre la copia para verificar que no quedó ninguna aparición.

    .venv/bin/python scripts/difuminar.py docs/capturas/aws docs/capturas/informe [ID-CUENTA] [IP-PUBLICA]
"""

import sys
from pathlib import Path

from PIL import Image
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()


def normalizar(texto: str) -> str:
    # El OCR a veces confunde O/0, l/1 o pone espacios dentro de los números.
    return texto.replace(" ", "").replace("O", "0").replace("o", "0").replace("l", "1").replace("I", "1")


def cajas_con(ruta: Path, valores: list[str]):
    resultado, _ = ocr(str(ruta))
    cajas = []
    for caja, texto, _conf in resultado or []:
        t = normalizar(texto)
        # Coincidencia completa o de un fragmento largo (el OCR puede cortar un ARN en dos líneas).
        if any(v in t or (len(v) >= 9 and any(v[i:i + 7] in t for i in range(len(v) - 6))) for v in valores):
            xs = [p[0] for p in caja]
            ys = [p[1] for p in caja]
            cajas.append((int(min(xs)) - 3, int(min(ys)) - 3, int(max(xs)) + 3, int(max(ys)) + 3, texto))
    return cajas


def pixelar(img: Image.Image, caja, bloque=8):
    x0, y0, x1, y1 = max(caja[0], 0), max(caja[1], 0), min(caja[2], img.width), min(caja[3], img.height)
    zona = img.crop((x0, y0, x1, y1))
    pequena = zona.resize((max(1, (x1 - x0) // bloque), max(1, (y1 - y0) // bloque)), Image.BILINEAR)
    img.paste(pequena.resize(zona.size, Image.NEAREST), (x0, y0))


def main(origen: Path, destino: Path, valores: list[str]):
    destino.mkdir(parents=True, exist_ok=True)
    total = 0
    for ruta in sorted(list(origen.glob("*.jpg")) + list(origen.glob("*.png"))):
        cajas = cajas_con(ruta, valores)
        img = Image.open(ruta).convert("RGB")
        for c in cajas:
            pixelar(img, c)
        # El OCR no siempre lee el texto pequeño del encabezado de la consola, donde siempre aparece
        # "usuario (número de cuenta)": se pixela esa zona fija en todas las capturas de consola.
        if ruta.suffix == ".jpg" and img.size == (1568, 737):
            pixelar(img, (1370, 0, 1568, 21, "encabezado"))
        salida = destino / ruta.name
        img.save(salida, quality=92) if salida.suffix == ".jpg" else img.save(salida)
        restantes = cajas_con(salida, valores)
        total += len(cajas)
        estado = "OK" if not restantes else f"QUEDAN {len(restantes)}: {[r[4] for r in restantes]}"
        print(f"{ruta.name}: {len(cajas)} zona(s) difuminada(s) -> {estado}")
    print(f"Total de zonas difuminadas: {total}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:])
