"""Graba un video corto de SIHO Lite funcionando en la nube (para la presentación).

    .venv/bin/python scripts/video_demo.py --base https://dxxxx.cloudfront.net --tokens loadtest/.secrets-tokens.json --salida entrega/video

Muestra la pantalla de inicio de sesión de Cognito (sin escribir credenciales), luego entra con la sesión
de un usuario de prueba obtenida por API, y recorre búsqueda, ficha, carga de documento, agenda,
reporte y auditoría. Cada solicitud actualiza el indicador de tarea y zona: se ve el balanceo en vivo.
Convierte el resultado a MP4 (H.264) con ffmpeg.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from capturas_app import pdf_de_prueba  # noqa: E402

ANCHO, ALTO = 1440, 900

SUBTITULO_JS = """(texto) => {
  let el = document.getElementById('siho-subtitulo');
  if (!el) {
    el = document.createElement('div');
    el.id = 'siho-subtitulo';
    el.style.cssText = 'position:fixed;left:24px;bottom:24px;z-index:99999;max-width:900px;padding:12px 18px;' +
      'border-radius:10px;background:rgba(16,40,47,.92);color:#fff;font:600 18px/1.35 system-ui,sans-serif;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.25)';
    document.body.appendChild(el);
  }
  el.textContent = texto;
}"""


def main(base: str, tokens: dict, salida: Path):
    base = base.rstrip("/")
    tmp = Path(tempfile.mkdtemp())
    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": ANCHO, "height": ALTO}, record_video_dir=str(tmp),
                              record_video_size={"width": ANCHO, "height": ALTO}, locale="es-CO", timezone_id="America/Bogota")
        page = ctx.new_page()
        sub = lambda t: page.evaluate(SUBTITULO_JS, t)  # noqa: E731
        pausa = page.wait_for_timeout

        def sesion(rol):
            page.evaluate("t => sessionStorage.setItem('siho.sesion', JSON.stringify(t))", tokens[rol])
            page.goto(base + "/")
            expect(page.locator(".barra")).to_be_visible()

        # 1. Inicio de sesión
        page.goto(base + "/")
        expect(page.locator(".login__tarjeta")).to_be_visible()
        sub("SIHO Lite en AWS · servido por CloudFront con HTTPS (solo datos sintéticos)")
        pausa(3500)
        page.get_by_role("button", name="Iniciar sesión con Amazon Cognito").click()
        page.wait_for_url("**amazoncognito.com/**", timeout=20000)
        pausa(1500)
        sub("Inicio de sesión con Amazon Cognito: contraseña + código MFA (TOTP) obligatorio")
        pausa(4000)

        # 2. Rol admisiones: búsqueda con el indicador de tarea y zona
        page.goto(base + "/")
        sesion("admisiones")
        # Apellidos con tilde: solo los tienen los pacientes del seed, no los que creó la prueba de carga.
        buscar = lambda q: (page.get_by_placeholder("Buscar por número de documento").fill(q),  # noqa: E731
                            page.get_by_role("button", name="Buscar", exact=True).click())
        buscar("garcía")
        sub("Cada respuesta indica qué tarea de ECS Fargate y en qué zona respondió (arriba a la derecha)")
        pausa(5000)
        for q in ["rodríguez", "martínez", "pérez", "gómez", "lópez", "sánchez"]:
            buscar(q)
            sub(f"Búsqueda «{q}»: el balanceador reparte cada solicitud entre las tareas de las dos zonas")
            pausa(2600)
        pausa(800)

        # 3. Ficha y documento
        page.locator("tbody tr").first.click()
        expect(page.get_by_text("Documentos clínicos")).to_be_visible()
        sub("Ficha del paciente: la consulta queda registrada en la auditoría")
        pausa(4500)
        page.locator("input[type=file]").set_input_files(str(pdf_de_prueba()))
        sub("Carga de un documento: va directo a S3 con URL prefirmada, SHA-256 y cifrado KMS")
        pausa(1500)
        page.get_by_role("button", name="Subir", exact=True).click()
        expect(page.locator(".alerta--ok")).to_be_visible(timeout=15000)
        pausa(4500)

        # 4. Agenda y admisiones
        page.locator(".nav").get_by_role("button", name="Agenda").click()
        sub("Agenda del día por profesional")
        pausa(4500)
        page.locator(".nav").get_by_role("button", name="Admisiones").click()
        sub("Admisiones abiertas con triage")
        pausa(4500)

        # 5. Rol admin: reporte y auditoría
        sesion("admin")
        page.locator(".nav").get_by_role("button", name="Ocupación").click()
        expect(page.get_by_text("Citas por especialidad")).to_be_visible(timeout=15000)
        sub("Rol admin: reporte de ocupación (la ruta más pesada de las pruebas de carga)")
        pausa(5000)
        page.mouse.wheel(0, 500)
        pausa(3500)
        page.locator(".nav").get_by_role("button", name="Auditoría").click()
        expect(page.locator("tbody tr").first).to_be_visible()
        sub("Auditoría de solo inserción: quién consultó o descargó qué y cuándo")
        pausa(5500)

        ruta_webm = Path(page.video.path())
        ctx.close()
        nav.close()

    salida.mkdir(parents=True, exist_ok=True)
    webm = salida / "siho-lite-demo.webm"
    shutil.move(ruta_webm, webm)
    mp4 = salida / "siho-lite-demo.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(webm), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-preset", "medium", "-crf", "23", "-movflags", "+faststart", str(mp4)], check=True)
    print(f"video: {mp4}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--tokens", required=True, type=Path)
    ap.add_argument("--salida", required=True, type=Path)
    a = ap.parse_args()
    main(a.base, json.loads(a.tokens.read_text()), a.salida)
