"""Recorre la aplicación con un navegador sin interfaz (Playwright) y guarda capturas para el informe.

Uso local (login de desarrollo por rol):
    .venv/bin/python scripts/capturas_app.py --base http://localhost:5173 --salida docs/capturas/local

Uso en AWS (token de Cognito obtenido por API para el usuario de prueba, ver loadtest/cognito_token.py):
    .venv/bin/python scripts/capturas_app.py --base https://dxxxx.cloudfront.net --modo cognito --salida docs/capturas/app

También funciona como prueba funcional de extremo a extremo: falla si un paso no aparece en pantalla.
"""

import argparse
import json
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

ANCHO, ALTO = 1440, 900


def pdf_de_prueba() -> Path:
    """PDF mínimo válido y sintético para probar la carga de documentos."""
    contenido = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length 58>>stream\nBT /F1 14 Tf 20 70 Td (Orden medica sintetica) Tj ET\nendstream endobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
    )
    ruta = Path(tempfile.gettempdir()) / "orden_medica_sintetica.pdf"
    ruta.write_bytes(contenido)
    return ruta


class Recorrido:
    def __init__(self, page: Page, base: str, salida: Path, modo: str, tokens: dict):
        self.page, self.base, self.salida, self.modo, self.tokens = page, base.rstrip("/"), salida, modo, tokens
        self.n = 0

    def captura(self, nombre: str, pagina_completa: bool = False):
        self.n += 1
        ruta = self.salida / f"{self.n:02d}_{nombre}.png"
        self.page.wait_for_timeout(400)
        self.page.screenshot(path=str(ruta), full_page=pagina_completa)
        print(f"  captura: {ruta}")

    def entrar(self, rol: str):
        self.page.evaluate("sessionStorage.clear()")
        if self.modo == "dev":
            self.page.goto(self.base + "/")
            self.page.get_by_role("button", name=rol, exact=True).click()
        else:
            token = self.tokens[rol]
            self.page.goto(self.base + "/")
            self.page.evaluate("t => sessionStorage.setItem('siho.sesion', JSON.stringify(t))", token)
            self.page.goto(self.base + "/")
        expect(self.page.locator(".barra")).to_be_visible()

    def ir(self, vista: str):
        self.page.locator(".nav").get_by_role("button", name=vista).click()


def correr(base: str, salida: Path, modo: str, tokens: dict):
    salida.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        navegador = p.chromium.launch()
        contexto = navegador.new_context(viewport={"width": ANCHO, "height": ALTO}, locale="es-CO", timezone_id="America/Bogota")
        page = contexto.new_page()
        r = Recorrido(page, base, salida, modo, tokens)

        print("Pantalla de inicio de sesión")
        page.goto(base + "/")
        expect(page.locator(".login__tarjeta")).to_be_visible()
        r.captura("login")
        if modo == "cognito":
            # Pantalla de managed login de Cognito (no se escriben credenciales en el formulario).
            page.get_by_role("button", name="Iniciar sesión con Amazon Cognito").click()
            page.wait_for_url("**amazoncognito.com/**", timeout=20000)
            page.wait_for_timeout(2500)
            r.captura("login_cognito_managed_login")

        print("Rol admisiones: búsqueda, ficha, documento, agenda y admisiones")
        r.entrar("admisiones")
        expect(page.locator("tbody tr").first).to_be_visible()
        expect(page.locator(".indicador b")).to_be_visible()
        r.captura("pacientes_con_indicador_tarea_az")

        page.get_by_placeholder("Buscar por número de documento").fill("gar")
        page.get_by_role("button", name="Buscar", exact=True).click()
        page.wait_for_timeout(600)
        r.captura("busqueda_pacientes")

        page.locator("tbody tr").first.click()
        expect(page.get_by_text("Documentos clínicos")).to_be_visible()
        page.locator("input[type=file]").set_input_files(str(pdf_de_prueba()))
        page.get_by_role("button", name="Subir", exact=True).click()
        expect(page.locator(".alerta--ok")).to_be_visible(timeout=15000)
        r.captura("ficha_paciente_documento_subido", pagina_completa=True)

        r.ir("Agenda")
        expect(page.get_by_text("Agenda del día")).to_be_visible()
        page.wait_for_timeout(800)
        r.captura("agenda_del_dia")

        r.ir("Admisiones")
        expect(page.locator("tbody tr").first).to_be_visible()
        r.captura("admisiones_abiertas")

        print("Rol médico: descarga de documento")
        r.entrar("medico")
        page.get_by_placeholder("Buscar por número de documento").fill("gar")
        page.get_by_role("button", name="Buscar", exact=True).click()
        page.wait_for_timeout(600)
        page.locator("tbody tr").first.click()
        expect(page.get_by_role("button", name="Descargar").first).to_be_visible()
        with page.expect_popup() as popup:
            page.get_by_role("button", name="Descargar").first.click()
        print(f"  descarga abierta: {popup.value.url.split('?')[0]}")
        popup.value.close()

        print("Rol admin: reporte de ocupación y auditoría")
        r.entrar("admin")
        r.ir("Ocupación")
        expect(page.get_by_text("Citas por especialidad")).to_be_visible(timeout=15000)
        r.captura("reporte_ocupacion", pagina_completa=True)
        r.ir("Auditoría")
        expect(page.locator("tbody tr").first).to_be_visible()
        r.captura("auditoria")

        navegador.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--salida", required=True, type=Path)
    ap.add_argument("--modo", choices=["dev", "cognito"], default="dev")
    ap.add_argument("--tokens", type=Path, help="JSON con sesiones por rol (modo cognito)")
    a = ap.parse_args()
    tokens = json.loads(a.tokens.read_text()) if a.tokens else {}
    try:
        correr(a.base, a.salida, a.modo, tokens)
    except Exception as e:  # noqa: BLE001
        print(f"FALLÓ el recorrido: {e}", file=sys.stderr)
        sys.exit(1)
    print("Recorrido completo.")
