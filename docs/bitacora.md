# Bitácora de SIHO Lite

Registro de lo que se hizo, las decisiones y los problemas reales encontrados (sección "Retos enfrentados" del informe).
Formato de cada problema: fecha, síntoma, causa, solución.

## Fase 0. Preparación (16 nov 2026)

- Herramientas verificadas: Node.js 24.21 (la imagen del contenedor usa `node:22-alpine`, que es lo que exige el diseño), Python 3.14, Docker 29.9 con Compose 5.7, Git 2.53, AWS CLI 2.36.
- Terraform no estaba instalado: se instaló la versión 1.17.2 en `~/.local/bin`, verificando el SHA-256 contra el archivo oficial de HashiCorp.
- Repositorio git local inicializado (rama `main`). Remoto: repositorio privado en la cuenta personal de GitHub.

### Decisiones de alcance (modo de un solo día, presupuesto mínimo)
El estudiante pidió explícitamente una solución sencilla y de bajo costo. Se aplica la sección 12 del diseño:

| Elemento | Decisión | Motivo |
|---|---|---|
| VPC, ALB, ECS Fargate (2 a 6 tareas), RDS, S3, CloudFront | Se implementa | Imprescindible |
| Autoescalado por CPU y por solicitudes + acción programada 6:15 a. m. | Se implementa | Imprescindible (balanceo dinámico, Rajammal y Chinnadurai, 2025) |
| Cognito, WAF, alarmas, escaneo de imagen en ECR | Se implementa | Recomendado; Cognito y el escaneo básico de ECR no tienen costo |
| Llave KMS propia (CMK) | Se reemplaza por llaves administradas por AWS (`aws/rds`, `aws/s3`, `aws/secretsmanager`) | Siguen siendo cifrado con KMS y no cuestan; la CMK cuesta USD 1/mes |
| CloudTrail | Se usa el historial de eventos (90 días, gratis) en lugar de crear un trail | Misma evidencia de trazabilidad sin costo de almacenamiento |
| GuardDuty, GitHub Actions con OIDC, Lambda predictiva, OWASP ZAP, restauración de RDS | Se omiten (opcionales) | Ahorro de tiempo y dinero; el despliegue se hace con `scripts/deploy.sh` |

## Fase 1. Aplicación local (16 nov 2026)

- API Node.js 22 + Express 5 con: validación `zod`, consultas parametrizadas, `helmet`, CORS limitado, logs JSON con `pino` (sin datos personales: la URL se registra sin query string), cierre ordenado ante `SIGTERM`, TLS verificado hacia RDS con el bundle de la CA de AWS incluido en la imagen, y JWT de Cognito con `aws-jwt-verify`.
- Base de datos: 6 tablas, índices del diseño, migraciones SQL con candado consultivo. Rol `siho_app` con mínimo privilegio: sin `DELETE` en ninguna tabla y solo `SELECT, INSERT` sobre `auditoria` (comprobado por prueba automática: `UPDATE`/`DELETE` devuelven error 42501).
- Seed sintético: 5.000 pacientes, 30 profesionales, 20.000 citas, 3.000 admisiones.
- Documentos: URL prefirmada PUT de 5 minutos que firma el `Content-Type` y el SHA-256 del archivo; S3 rechaza el archivo si no coincide.
- Cada respuesta incluye `X-Task-Id` y `X-AZ`; el frontend las muestra en la barra superior para demostrar el balanceo.
- Frontend React 19 + Vite 8: login (Cognito managed login con PKCE; en local, tokens de desarrollo por rol), pacientes y ficha, carga y descarga de documentos, agenda, admisiones, reporte de ocupación y auditoría.
- Pruebas: 13 de integración con Vitest + supertest contra PostgreSQL real, todas en verde. Recorrido de extremo a extremo con Playwright (`scripts/capturas_app.py`) que además genera las capturas.

### Problemas
- **16 nov. MinIO ya no publica imágenes de Docker.** Síntoma: `pull access denied for minio/mc`. Causa: MinIO dejó de distribuir imágenes de la edición comunitaria. Solución: se usó RustFS (compatible con S3, licencia Apache 2.0) para el entorno local, y el bucket se crea con un script del SDK de AWS.
- **16 nov. CORS en la subida local.** Para no depender del soporte de CORS del almacenamiento local, el navegador sube a través del proxy de Vite (mismo origen). Se conserva la cabecera `Host` (`changeOrigin: false`) para que la firma SigV4 de la URL prefirmada siga siendo válida.
- **16 nov. Faker JS no tiene locale `es_CO`.** Solución: locale `es` más listas colombianas propias (municipios del área del Hospital Regional del Fonce, EPS, tipos de documento CC/TI/RC/CE/PA según la edad).
- **16 nov. SDK v3 de AWS y URL prefirmadas.** Las versiones recientes agregan checksums CRC32 automáticos que el navegador no puede reproducir. Solución: `requestChecksumCalculation: 'WHEN_REQUIRED'` y firmar explícitamente el SHA-256 como cabecera.

## Capturas sugeridas (lista de control)
Local (ya tomadas en `docs/capturas/local/`): login, pacientes con indicador de tarea/AZ, búsqueda, ficha con documento subido, agenda, admisiones, reporte de ocupación, auditoría.

AWS (pendientes): consola de ECS con tareas en dos AZ; target group con destinos sanos; gráfica de tareas subiendo durante la carga; dashboard de CloudWatch; reglas de WAF y una solicitud bloqueada; bucket con bloqueo de acceso público y cifrado; RDS cifrada y en subred privada; Cognito con MFA; reporte de escaneo de la imagen en ECR; Budgets; la app funcionando por CloudFront con el indicador de tarea/AZ.
