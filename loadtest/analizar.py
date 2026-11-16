"""Genera las gráficas y el resumen de una prueba de carga (Locust + CloudWatch + monitor de ECS).

    .venv/bin/python loadtest/analizar.py docs/resultados/escalones

Lee de la carpeta: locust_stats_history.csv, locust_stats.csv, ecs_tareas.csv, distribucion_tareas.csv.
Consulta en CloudWatch (perfil "siho"): latencia del ALB, CPU del servicio, tareas sanas y errores 5xx.
Escribe PNG y resumen.md en la misma carpeta.
"""

import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

# Paleta categórica validada (orden fijo) y tokens de texto/superficie.
AZUL, NARANJA, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
TEXTO, TEXTO_2, MUTED, REJILLA, SUPERFICIE = "#0b0b0b", "#52514e", "#8a8984", "#e6e5e1", "#fcfcfb"
ZONA = timezone(timedelta(hours=-5))  # hora de Colombia

plt.rcParams.update({
    "figure.facecolor": SUPERFICIE, "axes.facecolor": SUPERFICIE, "savefig.facecolor": SUPERFICIE,
    "axes.edgecolor": REJILLA, "axes.labelcolor": TEXTO_2, "xtick.color": TEXTO_2, "ytick.color": TEXTO_2,
    "axes.grid": True, "grid.color": REJILLA, "grid.linewidth": 0.8, "axes.spines.top": False, "axes.spines.right": False,
    "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "bold", "axes.titlecolor": TEXTO, "axes.titlelocation": "left",
    "legend.frameon": False, "lines.linewidth": 2, "figure.dpi": 150,
})


def salida_tf(nombre):
    raiz = Path(__file__).resolve().parent.parent
    return subprocess.check_output(["terraform", f"-chdir={raiz / 'infra'}", "output", "-raw", nombre], text=True)


def metricas_cloudwatch(inicio, fin):
    cw = boto3.Session(profile_name="siho", region_name="us-east-1").client("cloudwatch")
    alb, tg = salida_tf("alb_arn_suffix"), salida_tf("tg_arn_suffix")
    cluster, servicio = salida_tf("cluster"), salida_tf("servicio")
    dim_tg = [{"Name": "LoadBalancer", "Value": alb}, {"Name": "TargetGroup", "Value": tg}]
    dim_ecs = [{"Name": "ClusterName", "Value": cluster}, {"Name": "ServiceName", "Value": servicio}]

    def q(id_, ns, nombre, dims, stat):
        return {"Id": id_, "MetricStat": {"Metric": {"Namespace": ns, "MetricName": nombre, "Dimensions": dims}, "Period": 60, "Stat": stat}}

    consultas = [
        q("p50", "AWS/ApplicationELB", "TargetResponseTime", dim_tg, "p50"),
        q("p95", "AWS/ApplicationELB", "TargetResponseTime", dim_tg, "p95"),
        q("p99", "AWS/ApplicationELB", "TargetResponseTime", dim_tg, "p99"),
        q("solicitudes", "AWS/ApplicationELB", "RequestCountPerTarget", dim_tg, "Sum"),
        q("sanas", "AWS/ApplicationELB", "HealthyHostCount", dim_tg, "Maximum"),
        q("err5xx", "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", dim_tg, "Sum"),
        q("cpu", "AWS/ECS", "CPUUtilization", dim_ecs, "Average"),
    ]
    r = cw.get_metric_data(MetricDataQueries=consultas, StartTime=inicio, EndTime=fin, ScanBy="TimestampAscending")
    series = {m["Id"]: pd.Series(m["Values"], index=pd.to_datetime(m["Timestamps"]).tz_convert(ZONA)) for m in r["MetricDataResults"]}
    return pd.DataFrame(series)


def formato_tiempo(ax):
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M", tz=ZONA))


def miles(n):
    return f"{n:,.0f}".replace(",", ".")


def etiqueta_final(ax, x, y, texto, color):
    """Etiqueta directa al final de la línea (texto en tinta, marcador con el color de la serie)."""
    ax.plot([x], [y], "o", color=color, markersize=5)
    ax.annotate(texto, (x, y), xytext=(6, 0), textcoords="offset points", va="center", color=TEXTO_2, fontsize=9)


def main(carpeta: Path):
    hist = pd.read_csv(carpeta / "locust_stats_history.csv")
    hist = hist[hist["Name"] == "Aggregated"].copy()
    hist["t"] = pd.to_datetime(hist["Timestamp"], unit="s", utc=True).dt.tz_convert(ZONA)
    for c in ["50%", "95%", "99%"]:
        hist[c] = pd.to_numeric(hist[c], errors="coerce") / 1000  # ms -> s
    inicio, fin = hist["t"].min(), hist["t"].max()
    # Se extiende la ventana 25 min para ver al servicio volver al mínimo (si ese tiempo ya pasó).
    fin_cw = min(fin + timedelta(minutes=25), datetime.now(timezone.utc))
    cw = metricas_cloudwatch(inicio - timedelta(minutes=2), fin_cw)
    ecs = pd.read_csv(carpeta / "ecs_tareas.csv")
    ecs["t"] = pd.to_datetime(ecs["timestamp"], unit="s", utc=True).dt.tz_convert(ZONA)

    # 1. Carga y escalado: usuarios, solicitudes/s y tareas en paneles apilados con el mismo eje de tiempo.
    fig, ejes = plt.subplots(3, 1, figsize=(10, 8.2), sharex=True, gridspec_kw={"hspace": 0.35})
    a, b, c = ejes
    a.plot(hist["t"], hist["User Count"], color=AZUL)
    a.set_title("Usuarios simulados (Locust)")
    b.plot(hist["t"], hist["Requests/s"], color=AZUL)
    b.set_title("Solicitudes por segundo")
    c.step(ecs["t"], ecs["deseadas"], where="post", color=AZUL, label="Deseadas (autoescalado)")
    c.step(ecs["t"], ecs["en_ejecucion"], where="post", color=NARANJA, label="En ejecución")
    if "sanas" in cw:
        c.step(cw.index, cw["sanas"], where="post", color=AQUA, label="Sanas en el ALB")
    c.set_title("Tareas de ECS Fargate")
    c.set_ylim(0, 7)
    c.legend(loc="upper left", ncols=3)
    for ax in ejes:
        formato_tiempo(ax)
    c.set_xlabel("Hora (Colombia)")
    fig.savefig(carpeta / "1_carga_y_escalado.png", bbox_inches="tight")
    plt.close(fig)

    # 2. Latencias percibidas por el cliente (Locust) con los criterios de éxito.
    fig, ax = plt.subplots(figsize=(10, 4.2))
    for col, color, nombre in [("50%", AZUL, "p50"), ("95%", NARANJA, "p95"), ("99%", AQUA, "p99")]:
        serie = hist[["t", col]].dropna()
        ax.plot(serie["t"], serie[col], color=color, label=nombre)
        if len(serie):
            etiqueta_final(ax, serie["t"].iloc[-1], serie[col].iloc[-1], nombre, color)
    ax.axhline(1, color=MUTED, linestyle="--", linewidth=1)
    ax.axhline(2, color=MUTED, linestyle=":", linewidth=1)
    ax.annotate("criterio p95 carga base: 1 s", (inicio, 1), xytext=(4, 4), textcoords="offset points", color=TEXTO_2, fontsize=8)
    ax.annotate("criterio p95 pico: 2 s", (inicio, 2), xytext=(4, 4), textcoords="offset points", color=TEXTO_2, fontsize=8)
    ax.set_title("Latencia percibida por el usuario (s), medida por Locust")
    ax.legend(loc="upper left", ncols=3)
    ax.set_ylim(bottom=0)
    formato_tiempo(ax)
    fig.savefig(carpeta / "2_latencias_cliente.png", bbox_inches="tight")
    plt.close(fig)

    # 3. Latencia del lado del servidor (ALB) y CPU, en paneles separados (sin doble eje).
    fig, (a, b) = plt.subplots(2, 1, figsize=(10, 6), sharex=True, gridspec_kw={"hspace": 0.35})
    for col, color in [("p50", AZUL), ("p95", NARANJA), ("p99", AQUA)]:
        if col in cw:
            a.plot(cw.index, cw[col], color=color, label=col)
    a.set_title("Tiempo de respuesta de las tareas según el ALB (s)")
    a.legend(loc="upper left", ncols=3)
    a.set_ylim(bottom=0)
    if "cpu" in cw:
        b.plot(cw.index, cw["cpu"], color=AZUL)
    b.axhline(60, color=MUTED, linestyle="--", linewidth=1)
    b.annotate("objetivo del autoescalado: 60 %", (cw.index.min(), 60), xytext=(4, 4), textcoords="offset points", color=TEXTO_2, fontsize=8)
    b.set_title("CPU promedio del servicio ECS (%)")
    b.set_ylim(0, 100)
    for ax in (a, b):
        formato_tiempo(ax)
    b.set_xlabel("Hora (Colombia)")
    fig.savefig(carpeta / "3_servidor_latencia_y_cpu.png", bbox_inches="tight")
    plt.close(fig)

    # 4. Distribución de solicitudes por tarea (balanceo least outstanding requests).
    dist_archivo = carpeta / "distribucion_tareas.csv"
    dist = pd.read_csv(dist_archivo) if dist_archivo.exists() else pd.DataFrame()
    totales = dist.drop(columns=["timestamp"]).sum().sort_values() if len(dist) else pd.Series(dtype=float)
    if len(totales):
        fig, ax = plt.subplots(figsize=(10, 0.5 * len(totales) + 1.2))
        ax.barh([t[:8] for t in totales.index], totales.values, color=AZUL, height=0.6)
        for i, v in enumerate(totales.values):
            ax.annotate(f"{miles(v)} ({100 * v / totales.sum():.1f} %)", (v, i), xytext=(4, 0), textcoords="offset points", va="center", color=TEXTO_2, fontsize=9)
        ax.set_title("Solicitudes atendidas por cada tarea (X-Task-Id)")
        ax.grid(axis="y", visible=False)
        ax.set_xlim(0, totales.max() * 1.2)
        fig.savefig(carpeta / "4_distribucion_por_tarea.png", bbox_inches="tight")
        plt.close(fig)

    # Resumen en Markdown
    stats = pd.read_csv(carpeta / "locust_stats.csv")
    agg = stats[stats["Name"] == "Aggregated"].iloc[0]
    total, fallas = agg["Request Count"], agg["Failure Count"]
    pct_err = 100 * fallas / total if total else 0
    max_deseadas = int(ecs["deseadas"].max()) if len(ecs) else 0
    primera_subida = ecs[ecs["deseadas"] > ecs["deseadas"].iloc[0]]["t"].min() if len(ecs) else None
    filas = []
    for _, f in stats.iterrows():
        tipo = "" if pd.isna(f["Type"]) else f"{f['Type']} "
        filas.append(f"| {tipo}{f['Name']} | {miles(f['Request Count'])} | {miles(f['Failure Count'])} | {f['50%']:.0f} | {f['95%']:.0f} | {f['99%']:.0f} | {f['Requests/s']:.1f} |")
    ultimo_sanas = cw["sanas"].dropna().iloc[-1] if "sanas" in cw and cw["sanas"].notna().any() else float("nan")
    resumen = f"""# Resultados: {carpeta.name}

- Ventana: {inicio:%Y-%m-%d %H:%M} a {fin:%H:%M} (hora de Colombia), {(fin - inicio).total_seconds() / 60:.0f} minutos.
- Solicitudes totales: {miles(total)}; fallidas: {miles(fallas)} (**{pct_err:.2f} %**; criterio < 1 %).
- Latencia agregada (cliente): p50 {agg['50%']:.0f} ms, **p95 {agg['95%']:.0f} ms**, p99 {agg['99%']:.0f} ms.
- Tareas: inicio {int(ecs['deseadas'].iloc[0]) if len(ecs) else '?'}, máximo **{max_deseadas}**; primera subida a las {primera_subida:%H:%M:%S} si hubo escalado.
- Tareas sanas al final de la ventana de CloudWatch: {ultimo_sanas:.0f} (debe volver a 2 tras la carga).
- CPU máxima promedio del servicio (por minuto): {cw['cpu'].max() if 'cpu' in cw else float('nan'):.0f} %.
- Errores 5xx del lado del servidor: {cw['err5xx'].sum() if 'err5xx' in cw else 0:.0f}.

| Endpoint | Solicitudes | Fallas | p50 (ms) | p95 (ms) | p99 (ms) | Solicitudes/s |
|---|---|---|---|---|---|---|
{chr(10).join(filas)}

Gráficas: `1_carga_y_escalado.png`, `2_latencias_cliente.png`, `3_servidor_latencia_y_cpu.png`, `4_distribucion_por_tarea.png`.
"""
    (carpeta / "resumen.md").write_text(resumen)
    print(resumen)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
