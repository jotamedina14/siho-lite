"""Gráfica del ciclo completo de elasticidad: escalones (subida) + valle (bajada) en un solo eje de tiempo.

    .venv/bin/python loadtest/ciclo_completo.py docs/resultados/escalones docs/resultados/valle docs/resultados/6_ciclo_completo_tareas.png
"""

import sys
from datetime import timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analizar import AQUA, AZUL, MUTED, NARANJA, TEXTO_2, ZONA, formato_tiempo, metricas_cloudwatch, plt  # noqa: E402


def leer(carpetas):
    hist, ecs = [], []
    for c in carpetas:
        h = pd.read_csv(c / "locust_stats_history.csv")
        h = h[h["Name"] == "Aggregated"].copy()
        h["t"] = pd.to_datetime(h["Timestamp"], unit="s", utc=True).dt.tz_convert(ZONA)
        hist.append(h)
        e = pd.read_csv(c / "ecs_tareas.csv")
        e["t"] = pd.to_datetime(e["timestamp"], unit="s", utc=True).dt.tz_convert(ZONA)
        ecs.append(e)
    return pd.concat(hist).sort_values("t"), pd.concat(ecs).sort_values("t")


def main(escalones: Path, valle: Path, salida: Path):
    hist, ecs = leer([escalones, valle])
    inicio, fin = hist["t"].min() - timedelta(minutes=2), ecs["t"].max()
    cw = metricas_cloudwatch(inicio, fin + timedelta(minutes=1))

    fig, (a, b) = plt.subplots(2, 1, figsize=(11, 6.5), sharex=True, gridspec_kw={"hspace": 0.35, "height_ratios": [1, 1.3]})
    a.plot(hist["t"], hist["User Count"], color=AZUL)
    a.set_title("Usuarios simulados: escalones de 20 a 180 y valle nocturno de 5")
    a.set_ylim(bottom=0)
    b.step(ecs["t"], ecs["deseadas"], where="post", color=AZUL, label="Deseadas (autoescalado)")
    b.step(ecs["t"], ecs["en_ejecucion"], where="post", color=NARANJA, label="En ejecución")
    if "sanas" in cw:
        b.step(cw.index, cw["sanas"], where="post", color=AQUA, label="Sanas en el ALB")
    b.axhline(2, color=MUTED, linestyle=":", linewidth=1)
    b.axhline(6, color=MUTED, linestyle=":", linewidth=1)
    b.annotate("mínimo: 2", (0, 2), xycoords=("axes fraction", "data"), xytext=(4, -12), textcoords="offset points", color=TEXTO_2, fontsize=8)
    b.annotate("máximo: 6", (0, 6), xycoords=("axes fraction", "data"), xytext=(4, 4), textcoords="offset points", color=TEXTO_2, fontsize=8)
    # Momento en que volvió al mínimo.
    bajada = ecs[(ecs["t"] > ecs.loc[ecs["deseadas"].idxmax(), "t"]) & (ecs["deseadas"] == 2)]
    if len(bajada):
        t2 = bajada["t"].iloc[0]
        b.annotate(f"vuelve a 2 tareas: {t2:%H:%M}", (t2, 2), xytext=(8, 22), textcoords="offset points",
                   color=TEXTO_2, fontsize=9, arrowprops={"arrowstyle": "-", "color": MUTED})
    b.set_title("Tareas de ECS Fargate: sube con la carga y vuelve al mínimo sin intervención")
    b.set_ylim(0, 8.5)
    b.set_yticks(range(0, 8, 2))
    b.legend(loc="upper right", ncols=3)
    for ax in (a, b):
        formato_tiempo(ax)
    b.set_xlabel("Hora (Colombia)")
    fig.savefig(salida, bbox_inches="tight")
    print(f"gráfica: {salida}")
    if len(bajada):
        fin_carga = hist[hist["User Count"] >= 150]["t"].max()
        print(f"fin del pico: {fin_carga:%H:%M:%S}; vuelve a 2 tareas: {t2:%H:%M:%S}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
