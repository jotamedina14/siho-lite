"""Convierte la salida de un comando (archivo de texto) en una captura con estilo de terminal.

    .venv/bin/python scripts/terminal_a_png.py docs/evidencias/seguridad.txt docs/capturas/_privado/consola_originales/01_pruebas_seguridad_terminal.png
"""

import html
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

PLANTILLA = """<!doctype html><html><head><meta charset="utf-8"><style>
body {{ margin: 0; background: #1b1f24; }}
.ventana {{ margin: 24px; border-radius: 10px; overflow: hidden; box-shadow: 0 10px 30px rgb(0 0 0 / 40%); width: 1240px; }}
.barra {{ background: #2d333b; padding: 10px 14px; display: flex; gap: 8px; align-items: center; }}
.barra i {{ width: 12px; height: 12px; border-radius: 50%; display: inline-block; }}
.barra span {{ color: #adbac7; font: 13px system-ui, sans-serif; margin-left: 10px; }}
pre {{ margin: 0; padding: 18px 20px; background: #22272e; color: #cdd9e5; font: 13px/1.5 'DejaVu Sans Mono', monospace; white-space: pre-wrap; word-break: break-all; }}
.cmd {{ color: #6cb6ff; font-weight: bold; }}
.com {{ color: #8b949e; font-weight: normal; }}
.ok {{ color: #57ab5a; font-weight: bold; }}
.no {{ color: #f47067; font-weight: bold; }}
</style></head><body><div class="ventana"><div class="barra"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>{titulo}</span></div><pre>{cuerpo}</pre></div></body></html>"""


def resaltar(linea: str) -> str:
    e = html.escape(linea)
    if linea.startswith("$ "):
        partes = e.split("    # ", 1)
        return f'<span class="cmd">{partes[0]}</span>' + (f'<span class="com">    # {partes[1]}</span>' if len(partes) > 1 else "")
    e = re.sub(r"(HTTP(?:/[\d.]+)? (?:200|301))", r'<span class="ok">\1</span>', e)
    e = re.sub(r"(HTTP(?:/[\d.]+)? (?:401|403)|AccessDenied|Sin respuesta)", r'<span class="no">\1</span>', e)
    return e


def main(entrada: Path, salida: Path):
    lineas = entrada.read_text().splitlines()
    cuerpo = "\n".join(resaltar(l) for l in lineas)
    salida.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pagina = nav.new_page(viewport={"width": 1290, "height": 400}, device_scale_factor=1.5)
        pagina.set_content(PLANTILLA.format(titulo=html.escape(f"bash — {entrada.name}"), cuerpo=cuerpo))
        pagina.locator(".ventana").screenshot(path=str(salida))
        nav.close()
    print(f"captura: {salida}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
