# Índice de capturas (evidencias)

Todas las capturas son de la cuenta personal del estudiante en us-east-1, tomadas el 16 de noviembre de 2026.
Los datos que aparecen en la aplicación son 100 % sintéticos.

## Aplicación en AWS (`app/`), por CloudFront con HTTPS

| Archivo | Qué demuestra | Sección del informe |
|---|---|---|
| `01_login.png` | Pantalla de inicio de SIHO Lite | 7. Implementación |
| `02_login_cognito_managed_login.png` | Inicio de sesión delegado a Amazon Cognito (managed login) | 6. Seguridad: identidad |
| `03_pacientes_con_indicador_tarea_az.png` | Búsqueda de pacientes y el indicador de la tarea/AZ que respondió (balanceo en vivo) | 7. Balanceo |
| `04_busqueda_pacientes.png` | Búsqueda por apellido sobre 5.000 pacientes sintéticos | 7. Implementación |
| `05_ficha_paciente_documento_subido.png` | Ficha del paciente y documento subido directo a S3 (URL prefirmada, SHA-256, SSE-KMS); el indicador muestra 2 tareas distintas | 7. Implementación / 6. Cifrado |
| `06_agenda_del_dia.png` | Agenda de citas del día | 7. Implementación |
| `07_admisiones_abiertas.png` | Admisiones abiertas con triage | 7. Implementación |
| `08_reporte_ocupacion.png` | Reporte de ocupación (ruta "pesada" de las pruebas de carga) | 7. Implementación |
| `09_auditoria.png` | Registro de auditoría de solo inserción (quién consultó qué) | 6. Trazabilidad |

## Consola de AWS y pruebas (`consola/`)

En el repositorio público solo están las copias con el número de cuenta y la IP pixelados; las originales se conservan fuera de git.

| Archivo | Qué demuestra | Control MinTIC / sección |
|---|---|---|
| `00_budgets_presupuesto_20usd.jpg` | Presupuesto de USD 20 con alertas al 50/80/100 % | Gestión de costos (9) |
| `01_pruebas_seguridad_terminal.png` | HTTP→HTTPS, cabeceras de seguridad, 401 sin token, 403 por rol, WAF bloquea SQLi y XSS, ALB inaccesible sin CloudFront, bucket sin acceso público, RDS cifrada y no pública, TLS forzado, MFA | Cifrado en tránsito, seguridad de red, gestión de identidades |
| `02_ecr_escaneo_1_vulnerabilidad_critica_zlib.jpg` | Escaneo de la imagen en ECR: 1 CVE crítica en zlib de la imagen base | Gestión de vulnerabilidades |
| `03_s3_bloqueo_acceso_publico_y_politica_tls.jpg` | Bucket de documentos con bloqueo de acceso público y política que niega conexiones sin TLS | Cifrado en tránsito / clasificación |
| `04_s3_etiquetas_y_cifrado_sse_kms.jpg` | Etiquetas obligatorias y cifrado SSE-KMS por defecto | Cifrado en reposo / costos |
| `05_rds_sg_solo_desde_tareas.jpg` | RDS solo acepta conexiones del grupo de seguridad de las tareas | Seguridad de red |
| `06_rds_cifrada_kms_configuracion.jpg` | RDS PostgreSQL 16 cifrada con KMS (aws/rds), credenciales en Secrets Manager | Cifrado en reposo |
| `07_cognito_mfa_obligatoria.jpg` | MFA obligatoria (TOTP) en el grupo de usuarios | Autenticación multifactor |
| `08_cognito_usuarios_prueba.jpg` | Usuarios de prueba sintéticos confirmados | Gestión de identidades |
| `09_cognito_grupos_por_rol.jpg` | Grupos admin, admisiones y medico (control de acceso por rol) | Mínimo privilegio |
| `10_waf_reglas.jpg` | Reglas del WAF: Common, KnownBadInputs, SQLi y límite de tasa por IP | Seguridad de red (OWASP) |
| `11_waf_inyeccion_sql_bloqueada.jpg` | Solicitud con inyección SQL bloqueada por el WAF (BLOCK) | Seguridad de red |
| `12_iam_rol_tarea_minimo_privilegio.jpg` | Rol de la tarea con solo PutObject/GetObject sobre `pacientes/*` | Mínimo privilegio |
| `13_secrets_manager.jpg` | Secretos: credenciales de RDS, del rol de aplicación y cabecera de origen | Gestión de secretos |
| `14_cloudtrail_historial_eventos.jpg` | Historial de CloudTrail: escaneos de ECR e inicios de sesión con reto MFA | Trazabilidad |
| `15_ecs_6_tareas_en_2_az_durante_carga.jpg` | 6 tareas Fargate corriendo, repartidas entre us-east-1a y us-east-1b | Disponibilidad / escalado |
| `16_resiliencia_target_group_drenando_tarea_detenida.jpg` | Prueba de resiliencia: tarea detenida a mano en "Draining", 5 sanas siguen atendiendo | Resiliencia (pruebas) |
| `17_ecs_eventos_autoescalado_y_reemplazo.jpg` | Eventos: el autoescalado sube a 3 y a 6 tareas; ECS reemplaza la tarea detenida | Escalado y resiliencia |
| `18_autoescalado_politicas_cpu_y_solicitudes.jpg` | Políticas de target tracking: CPU 60 % y 300 solicitudes por tarea; rango 2 a 6 | Balanceo dinámico (nivel reactivo) |
| `19_autoescalado_acciones_programadas_6_15.jpg` | Acciones programadas: 6:15 a. m. mínimo 3, 10:30 a. m. vuelve a 2 | Balanceo dinámico (nivel predictivo) |
| `20_cloudwatch_dashboard_pico_180_usuarios.jpg` | Dashboard durante el pico: solicitudes, latencia p50/p95/p99, tareas sanas 2→3→6, CPU, errores y RDS | Pruebas y resultados |
| `21_cloudwatch_alarma_autoescalado_disparada.jpg` | Alarma de autoescalado en estado ALARM durante la carga; alarmas propias en OK | Detección y respuesta |
| `22_ecs_eventos_reduccion_a_2_tareas.jpg` | Eventos de la reducción: la política de solicitudes baja el servicio de 6 a 5, 4, 3 y 2 tareas (18:37 a 18:49) | Escalado (elasticidad completa) |
| `23_ecr_escaneo_despues_0_vulnerabilidades.jpg` | Escaneo de la imagen corregida (`zlib` 1.4-r0): 0 vulnerabilidades críticas, altas, medias ni bajas | Gestión de vulnerabilidades (después) |

## Local (`local/`)
Las mismas pantallas de la aplicación en el entorno de desarrollo local (Docker Compose), antes del despliegue.
