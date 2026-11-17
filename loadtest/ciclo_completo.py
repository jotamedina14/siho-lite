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
        # Registro adicional del estado de ECS (vigilante cada 30 s), si existe.
        vig = c / "ecs_tareas_vigilante.csv"
        if vig.exists():
            v = pd.read_csv(vig)
            v["t"] = pd.to_datetime(v["timestamp"], unit="s", utc=True).dt.tz_convert(ZONA)
            ecs.append(v)
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
    ecs = ecs.drop_duplicates(subset="timestamp").sort_values("t").reset_index(drop=True)
    # El CSV de Locust del valle se cortó a las 18:42 (el resumen final confirma 5 usuarios durante 25 min):
    # se completa con el perfil programado del escenario.
    fin_escalones = pd.to_datetime(pd.read_csv(escalones / "locust_stats_history.csv")["Timestamp"].max(), unit="s", utc=True).tz_convert(ZONA)
    inicio_valle = pd.to_datetime(pd.read_csv(valle / "locust_stats_history.csv")["Timestamp"].min(), unit="s", utc=True).tz_convert(ZONA)
    if pd.notna(inicio_valle):
        fin_valle = inicio_valle + timedelta(minutes=25)
        relleno = pd.DataFrame({"t": pd.date_range(hist["t"].max(), fin_valle, freq="30s"), "User Count": 5})
        hist = pd.concat([hist[["t", "User Count"]], relleno, pd.DataFrame({"t": [fin_valle, fin_escalones + timedelta(seconds=1)], "User Count": [0, 0]})])
        hist = hist.sort_values("t").reset_index(drop=True)
    inicio, fin = hist["t"].min() - timedelta(minutes=2), max(ecs["t"].max(), hist["t"].max())
    cw = metricas_cloudwatch(inicio, fin + timedelta(minutes=1))

    fig, (a, b) = plt.subplots(2, 1, figsize=(11, 6.5), sharex=True, gridspec_kw={"hspace": 0.35, "height_ratios": [1, 1.3]})
    a.step(hist["t"], hist["User Count"], where="post", color=AZUL)
    # Tramo sin tráfico entre las dos pruebas y redespliegue con la imagen corregida.
    for ax in (a, b):
        ax.axvspan(fin_escalones, inicio_valle, color=MUTED, alpha=0.08, linewidth=0)
    a.annotate("sin tráfico", (fin_escalones + (inicio_valle - fin_escalones) / 2, 0), xytext=(0, 14),
               textcoords="offset points", ha="center", color=TEXTO_2, fontsize=8)
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
        b.annotate(f"vuelve a 2 tareas: {t2:%H:%M}", (t2, 2), xytext=(-150, -26), textcoords="offset points",
                   color=TEXTO_2, fontsize=9, arrowprops={"arrowstyle": "-", "color": MUTED})
    b.annotate("sin datos de solicitudes,\nla reducción espera", (fin_escalones + (inicio_valle - fin_escalones) / 2, 6), xytext=(0, -34),
               textcoords="offset points", ha="center", color=TEXTO_2, fontsize=8)
    b.annotate("redespliegue (zlib)\nsin errores", (pd.Timestamp("2026-11-16 18:52:00-05:00"), 3), xytext=(26, 22),
               textcoords="offset points", color=TEXTO_2, fontsize=8, arrowprops={"arrowstyle": "-", "color": MUTED})
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
