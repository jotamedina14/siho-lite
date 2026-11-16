# Resultados: escalones

- Ventana: 2026-11-16 18:00 a 18:25 (hora de Colombia), 25 minutos.
- Solicitudes totales: 68.413; fallidas: 0 (**0.00 %**; criterio < 1 %).
- Latencia agregada (cliente): p50 93 ms, **p95 140 ms**, p99 400 ms.
- Tareas: inicio 2, máximo **6**; primera subida a las 18:06:00 si hubo escalado.
- Tareas sanas al final de la ventana de CloudWatch: 6 (debe volver a 2 tras la carga).
- CPU máxima promedio del servicio (por minuto): 24 %.
- Errores 5xx del lado del servidor: 0.
- Balanceo con las 6 tareas activas (46.531 solicitudes): coeficiente de variación del reparto **0.7 %** (0 % = reparto perfecto).

| Endpoint | Solicitudes | Fallas | p50 (ms) | p95 (ms) | p99 (ms) | Solicitudes/s |
|---|---|---|---|---|---|---|
| GET /api/citas?fecha= | 11.151 | 0 | 100 | 160 | 620 | 7.4 |
| POST /api/pacientes [POST] | 5.482 | 0 | 88 | 120 | 270 | 3.7 |
| GET /api/pacientes/:id | 13.271 | 0 | 88 | 120 | 410 | 8.8 |
| GET /api/pacientes?q= | 32.927 | 0 | 93 | 140 | 350 | 21.9 |
| GET /api/reportes/ocupacion | 5.582 | 0 | 98 | 170 | 490 | 3.7 |
| Aggregated | 68.413 | 0 | 93 | 140 | 400 | 45.6 |

Gráficas: `1_carga_y_escalado.png`, `2_latencias_cliente.png`, `3_servidor_latencia_y_cpu.png`, `4_distribucion_por_tarea.png`.
