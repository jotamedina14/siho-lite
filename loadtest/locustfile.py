"""Pruebas de carga de SIHO Lite con Locust.

Mezcla de tráfico del diseño: 60 % búsquedas, 20 % agenda, 10 % creación, 10 % reportes.
Escenarios (variable ESCENARIO): base, escalones, rafaga.

    ESCENARIO=escalones .venv/bin/locust -f loadtest/locustfile.py --host https://dxxxx.cloudfront.net \
        --headless --csv docs/resultados/escalones/locust --html docs/resultados/escalones/locust.html

Mientras corre, un monitor consulta ECS cada 15 s (tareas deseadas y en ejecución) y se cuenta qué tarea
respondió cada solicitud (cabecera X-Task-Id) para medir la distribución del balanceo.
"""

import csv
import os
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

import boto3
import gevent
from locust import HttpUser, LoadTestShape, between, events, task

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cognito import obtener_token, salida_tf  # noqa: E402

ESCENARIO = os.environ.get("ESCENARIO", "escalones")
SALIDA = Path(os.environ.get("SALIDA", f"docs/resultados/{ESCENARIO}"))
PREFIJOS = ["gar", "rod", "mar", "gon", "lop", "her", "per", "san", "ram", "tor", "dia", "cas", "mor", "ort", "jim", "rui", "var", "suar", "1", "2", "3"]
TOKEN = None
por_tarea = defaultdict(Counter)  # segundo (redondeado a 10 s) -> {tarea: solicitudes}


@events.init.add_listener
def al_iniciar(environment, **_):
    global TOKEN
    # SIHO_TOKEN permite probar el script contra el entorno local (token de desarrollo).
    TOKEN = os.environ.get("SIHO_TOKEN") or obtener_token("carga")["idToken"]
    if not os.environ.get("SIHO_TOKEN"):
        gevent.spawn(monitor_ecs)


@events.request.add_listener
def al_responder(response=None, exception=None, **_):
    if response is not None and exception is None:
        tarea = response.headers.get("X-Task-Id")
        if tarea:
            por_tarea[int(time.time()) // 10 * 10][tarea] += 1


def monitor_ecs():
    """Registra cada 15 s las tareas deseadas y en ejecución del servicio."""
    ecs = boto3.Session(profile_name="siho", region_name="us-east-1").client("ecs")
    cluster, servicio = salida_tf("cluster"), salida_tf("servicio")
    SALIDA.mkdir(parents=True, exist_ok=True)
    with open(SALIDA / "ecs_tareas.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "deseadas", "en_ejecucion", "pendientes"])
        while True:
            try:
                s = ecs.describe_services(cluster=cluster, services=[servicio])["services"][0]
                w.writerow([int(time.time()), s["desiredCount"], s["runningCount"], s["pendingCount"]])
                f.flush()
            except Exception as e:  # noqa: BLE001
                print(f"monitor ECS: {e}", file=sys.stderr)
            gevent.sleep(15)


@events.quitting.add_listener
def al_terminar(**_):
    SALIDA.mkdir(parents=True, exist_ok=True)
    tareas = sorted({t for c in por_tarea.values() for t in c})
    with open(SALIDA / "distribucion_tareas.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", *tareas])
        for ts in sorted(por_tarea):
            w.writerow([ts, *[por_tarea[ts].get(t, 0) for t in tareas]])


def texto_aleatorio(n):
    return "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(n)).capitalize()


class UsuarioHospital(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        self.client.headers.update({"Authorization": f"Bearer {TOKEN}", "User-Agent": "siho-lite-locust/1.0"})
        self.ids = []

    @task(6)
    def buscar_pacientes(self):
        q = random.choice(PREFIJOS)
        with self.client.get("/api/pacientes", params={"q": q, "page": random.randint(1, 3)}, name="/api/pacientes?q=", catch_response=True) as r:
            if r.ok:
                datos = r.json().get("datos", [])
                self.ids = [p["id"] for p in datos[:5]] or self.ids
        if self.ids and random.random() < 0.4:
            self.client.get(f"/api/pacientes/{random.choice(self.ids)}", name="/api/pacientes/:id")

    @task(2)
    def ver_agenda(self):
        dia = date.today() + timedelta(days=random.randint(-30, 30))
        self.client.get("/api/citas", params={"fecha": dia.isoformat()}, name="/api/citas?fecha=")

    @task(1)
    def crear_paciente(self):
        self.client.post("/api/pacientes", name="/api/pacientes [POST]", json={
            "tipoDocumento": "CC",
            "numeroDocumento": str(random.randint(10**11, 10**12 - 1)),
            "nombres": texto_aleatorio(6),
            "apellidos": f"{texto_aleatorio(7)} {texto_aleatorio(6)}",
            "fechaNacimiento": (date(1940, 1, 1) + timedelta(days=random.randint(0, 30000))).isoformat(),
            "sexo": random.choice(["F", "M"]),
            "municipio": "San Gil",
        })

    @task(1)
    def reporte_ocupacion(self):
        hasta = date.today() - timedelta(days=random.randint(0, 30))
        desde = hasta - timedelta(days=30)
        self.client.get("/api/reportes/ocupacion", params={"desde": desde.isoformat(), "hasta": hasta.isoformat()}, name="/api/reportes/ocupacion")


class Escenario(LoadTestShape):
    """Etapas: (duración acumulada en s, usuarios, usuarios por segundo al llegar)."""

    ETAPAS = {
        "base": [(600, 20, 2)],
        "escalones": [(300, 20, 2), (600, 60, 4), (900, 120, 6), (1200, 180, 6), (1500, 10, 10)],
        "rafaga": [(60, 10, 2), (90, 200, 7), (390, 200, 7), (570, 10, 10)],
        "corta": [(60, 10, 2), (240, 60, 3)],  # verificación rápida del escalado
    }[ESCENARIO]

    def tick(self):
        t = self.get_run_time()
        for fin, usuarios, tasa in self.ETAPAS:
            if t < fin:
                return usuarios, tasa
        return None
