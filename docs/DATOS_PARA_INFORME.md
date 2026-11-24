# Datos exactos y correcciones para el informe

Revisión del borrador `Informe_SIHO_Lite_Yonathan_Lopez_BORRADOR.pdf` (20 páginas) contra lo que realmente se construyó y midió.
Todos los datos salen de `docs/resultados/escalones/`, `docs/bitacora.md`, `docs/evidencias/` y la consola de AWS.

## 1. Correcciones de contenido (el borrador dice algo que no es exacto)

| Página / sección | Dice | Lo correcto |
|---|---|---|
| Resumen y p. 13 (prueba de carga) | "En el pico de 180 usuarios el sistema atendió cerca de 4.200 solicitudes por minuto" | 4.200 por minuto fue con **120** usuarios. Con **180 usuarios fueron unas 6.240 solicitudes por minuto** (104 por segundo; el ALB registró 6.019 a 6.333 por minuto entre 18:16 y 18:19) |
| Tabla 7, columna "Tareas" | 60 usuarios: "2 a 3"; 120 usuarios: "3 a 6" | El servicio pasó de 2 a 3 a las 18:06 **y a 6 a las 18:09, ya en el escalón de 60 usuarios**. Con 120 y 180 usuarios se mantuvo en 6 (el máximo) |
| p. 13 "Con 60 usuarios la alarma de solicitudes por tarea superó el umbral de 300" | — | El umbral de 300 por tarea **ya se superaba con 20 usuarios** (unas 350 por minuto por tarea con 2 tareas). La alarma exige 3 minutos seguidos por encima y CloudWatch publica con 1 o 2 minutos de retraso, por eso se disparó a las **18:05:59**, justo al comenzar el escalón de 60 usuarios; el servicio pasó a 3 tareas a las 18:06 y a 6 a las 18:09 |
| Tabla 7, fila 180 usuarios | "~70" solicitudes por segundo | **104** solicitudes por segundo (70 corresponde a 120 usuarios) |
| p. 13 "Cada usuario virtual obtiene su token de Cognito" | — | Locust inicia sesión **una sola vez** al comenzar con un usuario de prueba (usuario, contraseña y código TOTP) y todos los usuarios virtuales comparten ese token |
| p. 10 "Faker en configuración colombiana" | — | Faker para JavaScript **no trae el locale es_CO**: se usó el locale `es` más listas colombianas propias (municipios del área del Hospital Regional del Fonce, EPS y tipos de documento CC, TI, RC, CE y PA según la edad) |
| p. 10 "Terraform organizado por módulos de red, seguridad…" | — | Un solo directorio `infra/` con **archivos por dominio** (`red.tf`, `datos.tf`, `computo.tf`, `borde.tf`, `identidad.tf`, `observabilidad.tf`), sin módulos, por simplicidad |
| Tabla 3, autenticación multifactor | "para las cuentas de administración de AWS" | MFA activa en la **cuenta raíz**. Se trabajó con credenciales temporales de la raíz obtenidas con `aws login` (sin llaves de larga duración); queda como decisión consciente del prototipo y en producción se usaría IAM Identity Center |
| Tabla 3, trazabilidad | "CloudTrail" | **Historial de eventos de CloudTrail** (90 días, gratis); no se creó un *trail* para no pagar almacenamiento |
| p. 12, pruebas funcionales | "inicio de sesión con MFA, … agendamiento de una cita, apertura de una admisión…" | En la nube, el recorrido automático con Playwright hizo: inicio de sesión con token MFA, búsqueda, ficha, **subida y descarga de un PDF**, agenda, admisiones, reporte y auditoría. Crear pacientes, citas (con validación de cruce) y admisiones se probó con las **13 pruebas de integración** y en local; en la nube la prueba de carga **creó 5.482 pacientes** sin errores |
| p. 12, pruebas automatizadas | "[número de pruebas y cobertura]" | **13 pruebas de integración** (Vitest + supertest contra PostgreSQL real), todas en verde. **No se midió cobertura**; mejor no reportar un porcentaje |
| Tabla 5, "El dominio propio no estaba disponible" | — | Ese dominio era de otro proyecto, no de SIHO Lite. El reto real es: **sin dominio propio no hay certificado para el ALB**, así que el tramo CloudFront → ALB va por HTTP dentro de la red de AWS. Se mitigó con la cabecera secreta `X-Origin-Verify` y un grupo de seguridad que solo admite las IP de origen de CloudFront (el acceso directo al ALB no responde) |
| p. 15, resiliencia | "en menos de un minuto" | Tarea detenida a las 18:11:01, reemplazo iniciado a las 18:11:28, **registrado sano a las 18:12:06 (unos 65 s)** y servicio estable a las 18:12:15. Locust registró **0 fallas** en toda la prueba, incluido ese minuto |
| p. 14–15, hallazgo de la CPU | "pasa la mayor parte del tiempo esperando respuestas de la base de datos" | Correcto como explicación, pero se puede precisar: cada tarea atendía unas 17 solicitudes por segundo en el pico, carga liviana para Node.js, que no bloquea mientras espera a PostgreSQL. La CPU máxima de la API fue **24 %** y la de RDS **~41 %**. Además, **el objetivo de 300 solicitudes por minuto por tarea resultó conservador**: con 6 tareas la CPU no pasó del 24 %; en producción se calibraría más alto para gastar menos (el diseño decía "valor a calibrar con las pruebas") |
| p. 17 | Página en blanco | Sobra; quitar el salto de página doble antes de las referencias |
| Referencias, Rajammal | Sin volumen ni número de artículo | Rajammal, K., & Chinnadurai, M. (2025). Dynamic load balancing in cloud computing using predictive graph networks and adaptive neural scheduling. *Scientific Reports, 15*, Artículo 22181. https://doi.org/10.1038/s41598-025-97494-2 |
| Conclusiones, trabajo futuro | "[Ajustar si se implementó alguno]" | **Ninguno se implementó** (ni GitHub Actions ni escalador predictivo; el despliegue se hizo con `scripts/deploy.sh`) |

### Retos adicionales para la Tabla 5 (fila "[Otros retos de la bitácora]")

| Reto | Causa | Solución |
|---|---|---|
| El servicio no volvía a 2 tareas al terminar la prueba | El autoescalado solo reduce si todas las políticas lo permiten; con tráfico cero, la métrica de solicitudes por tarea no tiene datos y bloquea la reducción | Se simuló el tráfico nocturno de fondo (5 usuarios); en producción el tráfico nunca es cero |
| La prueba de carga desde un solo equipo habría chocado con el WAF | La regla de límite de tasa bloquea más de 1.000 solicitudes en 5 minutos por IP | Se excluyó la IP del equipo de pruebas de esa regla con un IP set del WAF |
| MinIO ya no publica imágenes de Docker | El proyecto dejó de distribuir la edición comunitaria | Se usó RustFS, compatible con S3, para el entorno local |
| Las URL prefirmadas fallaban desde el navegador | Las versiones recientes del SDK de AWS agregan checksums automáticos que el navegador no puede reproducir | Se desactivó el checksum automático y se firmó explícitamente el SHA-256 del archivo |
| Datos personales visibles en las capturas | El número de cuenta y la IP aparecen en la consola | Copias pixeladas con OCR para el informe |

## 2. Datos que faltaban

| Dato | Valor |
|---|---|
| URL del repositorio | https://github.com/jotamedina14/siho-lite (**privado**: hay que darle acceso al docente o hacerlo público al entregar) |
| URL de la app | https://d2b8b221bu4poi.cloudfront.net (deja de existir al hacer `terraform destroy`; poner "desplegada del 16 de noviembre de 2026 hasta su destrucción") |
| Recursos creados por Terraform | **85** (2 de ECR primero y 83 después) |
| Datos sintéticos (seed) | **5.000 pacientes, 30 profesionales, 20.000 citas y 3.000 admisiones** |
| Pruebas automáticas | 13 de integración, todas en verde |
| Vulnerabilidad | **CVE-2026-4738**, crítica, paquete **`zlib` 1.3.2-r1** de la imagen base `node:22-alpine` (Alpine 3.24); corregida con **`zlib` 1.4-r0** (`apk upgrade` en el Dockerfile). Resultado después (imagen `v20261116-185035-47f7907`, escaneada a las 18:51): **0 vulnerabilidades** (críticas, altas, medias y bajas). Redespliegue sin cortes a las 18:50–18:54, con tráfico activo y **0 errores** |
| Acción programada | **6:15 a. m.** hora de Colombia: mínimo 3 tareas (máximo 6); **10:30 a. m.**: vuelve a mínimo 2 (máximo 6) |
| Retiro gradual de tareas | 30 s (deregistration delay); health check `/health` cada 10 s |
| Tiempo en volver a 2 tareas | El pico terminó a las 18:20. Entre las 18:25 y las 18:37 no hubo tráfico y el servicio **no redujo** (la métrica de solicitudes por tarea no tenía datos; ver retos). Con tráfico de fondo (5 usuarios desde las 18:37:02) bajó **una tarea cada ~4 minutos**: 6 → 5 (18:37:48), → 4 (18:41:25), → 3 (18:45:33), → **2 (18:49:40)**, es decir **12,6 minutos** desde que volvió a haber tráfico. La reducción es gradual por el enfriamiento de 180 s configurado para bajar |
| Costo real | ≈ USD 16,25 del 16 al 23 de noviembre; USD 2,49 por día en estado estable (≈ USD 75 al mes frente a USD 80 estimados); 100 % pagado con créditos. Detalle en `docs/resultados/costo_real.md` |

### Escenario de valle (tráfico nocturno de fondo, 18:37 a 19:02)
5 usuarios durante 25 minutos: **4.309 solicitudes, 0 fallidas**, p50 99 ms y p95 150 ms (resumen final de Locust en `docs/resultados/valle/locust_consola.log`). Durante este escenario el servicio volvió a 2 tareas y se redesplegó la imagen corregida sin errores.

### Las 13 pruebas automáticas (Vitest + supertest contra PostgreSQL 16 real, todas en verde)
- 1. GET /health responde ok con la base conectada
- 2. rechaza /api sin token (401)
- 3. rechaza un token con firma inválida (401)
- 4. /api/info devuelve la tarea y la zona que respondió
- 5. médico no puede crear pacientes (403)
- 6. admisiones crea un paciente y no permite duplicar el documento
- 7. valida la entrada (400)
- 8. consultar la ficha registra auditoría
- 9. no permite agendar dos citas cruzadas para el mismo profesional (409)
- 10. urgencias exige triage
- 11. entrega URL prefirmada PUT con checksum y solo permite PDF/JPG/PNG
- 12. el reporte de ocupación es solo para admin
- 13. el rol de la aplicación no puede modificar ni borrar la auditoría

## 3. Tabla 7 completa (prueba por escalones, 16 nov 2026, 18:00 a 18:25 hora de Colombia)

Cada escalón sin su primer minuto (rampa). **Cliente** = medido por Locust desde Colombia (incluye internet), a partir de los percentiles por ventana de 10 s del reporte HTML (`locust_historial_ventana.csv`): se da la mediana de las ventanas y el peor valor. **ALB** = tiempo de respuesta de las tareas, por minuto, desde CloudWatch.

| Escalón | Usuarios | Solicitudes/s | Solicitudes/min | p95 cliente (mediana / peor ventana) | p95 ALB (prom / máx) | CPU API (prom / máx) | Errores | Tareas |
|---|---|---|---|---|---|---|---|---|
| 1 | 20 | 11,7 | 705 | 110 / 240 ms | 16 / 17 ms | 9,7 / 10,4 % | 0 | 2 |
| 2 | 60 | 34,9 | 2.094 | 120 / 570 ms | 22 / 37 ms | 18,3 / 22,2 % | 0 | 2 → 3 (18:06) → 6 (18:09) |
| 3 | 120 | 70,0 | 4.199 | 115 / 770 ms | 27 / 42 ms | 17,9 / 19,5 % | 0 | 6 (5 durante 1 min, prueba de resiliencia) |
| 4 | 180 | 104,0 | 6.240 | 120 / 1.700 ms | 36 / 44 ms | 23,6 / 24,0 % | 0 | 6 |

Los picos de la peor ventana coinciden con eventos: la llegada de tareas nuevas (escalón 2), la prueba de resiliencia (escalón 3) y una ventana de 10 s a las 18:17 con 180 usuarios (escalón 4). Todos quedan por debajo del criterio de 2 s.

Totales de la prueba (cliente, incluye el viaje por internet Colombia → Virginia):
- **68.413 solicitudes, 0 fallidas (0,00 %)**, 0 errores 5xx en el servidor.
- p50 **93 ms**, p95 **140 ms**, p99 **400 ms** (criterios: p95 < 1 s en carga base y < 2 s en el pico, errores < 1 %: **se cumplen**).
- La diferencia entre el p95 del servidor (16 a 44 ms) y el del usuario (140 ms) es casi toda la latencia de internet.
- **Balanceo:** con las 6 tareas activas (18:12 a 18:25, 46.531 solicitudes) cada tarea atendió entre el 16,4 % y el 16,7 %: **coeficiente de variación de 0,7 %** (reparto casi perfecto del algoritmo de menor número de solicitudes pendientes).
- Pico de solicitudes por tarea: 1.055 por minuto, frente al objetivo de 300; por eso el servicio llegó al máximo de 6 ya con 60 usuarios.

## 4. Figuras (en `docs/resultados/escalones/`)

| Figura del informe | Archivo |
|---|---|
| Figura 1. Arquitectura | `docs/arquitectura/arquitectura.png` (SVG editable al lado) |
| Figura 2. Solicitudes por segundo y latencia | `1_carga_y_escalado.png` (usuarios, solicitudes/s y tareas) y `2_latencias_cliente.png` |
| Figura 3. Tareas frente a la carga (ciclo completo) | `docs/resultados/6_ciclo_completo_tareas.png`: sube de 2 a 6, espera sin tráfico, baja a 2 a las 18:49 y el redespliegue no causa errores |
| Figura 4. CPU y solicitudes por tarea | `5_cpu_vs_solicitudes_por_tarea.png` |
| Figura 5 sugerida. Reparto entre tareas | `4_distribucion_por_tarea.png`: es la mejor evidencia del balanceo |
| Complementaria | `3_servidor_latencia_y_cpu.png` (latencia del ALB y CPU) |

Datos crudos: `locust_stats.csv`, `locust_stats_history.csv`, `cloudwatch_metricas.csv`, `ecs_tareas.csv`, `distribucion_tareas.csv`; reporte HTML de Locust: `locust.html`; resumen: `resumen.md`.
