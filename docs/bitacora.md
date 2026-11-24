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

## Fase 2. Infraestructura (16 nov 2026)

- Cuenta personal [ID de cuenta] (plan pagado con USD 103,47 en créditos). La raíz tiene MFA activo.
- **Decisión consciente:** se trabajó con credenciales temporales de la raíz obtenidas con `aws login` (sin llaves de larga duración). En producción se usaría IAM Identity Center o un rol de administración. El perfil `siho` está aislado de los perfiles de trabajo que existen en el equipo, y `scripts/entorno_aws.sh` impide desplegar si el perfil apunta a otra cuenta.
- Presupuesto `SIHO-Lite-20USD` creado con la CLI antes que cualquier otro recurso. Desde el 30 de septiembre de 2026, AWS exige verificar el correo de los destinatarios nuevos de Budgets.
- `terraform plan`: 85 recursos por crear. Se aplicó en dos pasos: primero ECR (para publicar la imagen) y luego el resto con la etiqueta real de la imagen. Así el servicio arranca con una imagen que ya existe.
- La IP pública desde donde se lanza Locust se excluye de la regla de límite de tasa del WAF (1.000 solicitudes en 5 minutos por IP). Sin esa excepción, la prueba de carga desde un solo equipo quedaría bloqueada por el propio WAF.

### Hallazgo de costos previos de la cuenta
Al revisar la factura de noviembre aparecieron unos USD 6 brutos (USD 0 netos, cubiertos por créditos) que no son del proyecto: una instancia EC2 t3.micro `rag-tunnel` con IP elástica encendida desde el 7 de octubre (USD 3,80 de cómputo, USD 1,84 de IPv4 pública y USD 0,32 de EBS en el mes) y una zona de Route 53 (USD 0,50/mes). Se dejan para que el dueño decida al final.

## Fase 2 a 6. Despliegue, seguridad, escalado y pruebas (16 nov 2026)

- `terraform apply`: 85 recursos en unos 15 minutos (RDS y CloudFront son los más lentos). App en `https://d2b8b221bu4poi.cloudfront.net`.
- Migraciones y seed por una tarea única de ECS con TLS verificado contra la CA de RDS.
- Usuarios de prueba en Cognito con MFA TOTP configurada por API (`loadtest/cognito.py`); los secretos TOTP quedan en un archivo local no versionado.
- Pruebas de seguridad por la URL pública (`docs/evidencias/seguridad.txt`): todas pasaron.
- Recorrido de extremo a extremo con Playwright en la nube, incluida la subida real de un PDF a S3 con SHA-256 y SSE-KMS.

### Problemas
- **16 nov. La primera tarea quedó en un ciclo de reinicio.** Síntoma: una de las dos tareas no pasaba el health check al terminar el `apply`. Causa: `/health` consulta la base de datos y el rol `siho_app` aún no existía (las migraciones se corren después del `apply`). Solución: correr `scripts/deploy.sh migrar` apenas termina el `apply`; ECS reemplazó la tarea sola. Mejora futura: health check de "vida" separado del de "preparación".
- **16 nov. `boto3` no podía usar la sesión de `aws login`.** Error `MissingDependencyException`. Solución: instalar `botocore[crt]`.
- **16 nov. El escaneo de ECR no aparecía en la imagen etiquetada.** Causa: `docker buildx` publica por defecto un índice de imagen con atestación de procedencia, y el escaneo básico de ECR analiza el manifiesto de la imagen, no el índice. Solución: consultar el escaneo en el manifiesto hijo y construir con `--provenance=false --sbom=false` en adelante.
- **16 nov. Vulnerabilidad crítica CVE-2026-4738 en `zlib` 1.3.2-r1** de la imagen base `node:22-alpine`, detectada por el escaneo de ECR. Alpine ya publicó `zlib` 1.4-r0. Solución: `apk upgrade --no-cache` en la etapa final del Dockerfile y redespliegue sin cortes.
- **16 nov. Capturas con el puntero visible.** Se retomaron todas moviendo el puntero fuera del contenido antes de cada captura.

### Prueba de carga por escalones (resultados preliminares, ver `docs/resultados/escalones/`)
- 18:00 inicio con 20 usuarios y 2 tareas. 18:05 la política `ALBRequestCountPerTarget` (> 300 por minuto por tarea) subió a 3 tareas; 18:08 subió a 6 (el máximo).
- La CPU de las tareas se mantuvo alrededor del 20 %: **el escalado lo disparó la política de solicitudes y no la de CPU**. Para esta carga de lectura el cuello de botella previsible es la base de datos (la CPU de RDS llegó a ~41 % en el pico), no el cómputo de la API.
- **Resiliencia (18:11):** con 120 usuarios se detuvo a mano una tarea de us-east-1a. El ALB la pasó a "draining", las otras 5 siguieron atendiendo, ECS lanzó un reemplazo en menos de 1 minuto y el servicio volvió a estado estable a las 18:12.
- **16 nov. El servicio no volvía a 2 tareas después de la prueba.** Síntoma: a las 18:36, 16 minutos después de bajar la carga, seguía en 6 tareas. Causa: el autoescalado solo reduce cuando **todas** las políticas lo permiten. La de CPU sí pedía bajar (su alarma baja estaba en ALARM), pero al terminar Locust el tráfico quedó en cero; sin solicitudes, `ALBRequestCountPerTarget` **no publica datos**, su alarma baja nunca acumula los 15 minutos por debajo de 270 y bloquea la reducción. Solución: escenario `valle` de Locust (5 usuarios durante 25 minutos, equivalente al tráfico nocturno de fondo de un hospital) para que la métrica tenga datos. Lección para producción: con tráfico real nunca es cero, pero conviene saber que una política por solicitudes no reduce en ausencia total de tráfico.
- **16 nov. Locust guarda percentiles acumulados.** Sin `--csv-full-history`, el historial guarda los percentiles acumulados desde el inicio de la prueba, no por ventana; la gráfica de latencia de cliente se rotuló así y la latencia por escalón se tomó del ALB. Las pruebas siguientes se corren con `--csv-full-history`.
- **16 nov. Capturas con datos personales.** El número de cuenta y la IP pública aparecen en las capturas. `scripts/difuminar.py` los ubica con OCR y los pixela en copias para el repositorio y el informe (`docs/capturas/consola/`); las originales quedan fuera de git; como el OCR no siempre lee el encabezado de la consola, esa zona se pixela siempre.
- **16 nov. Cierre del ciclo de elasticidad.** Con el escenario `valle` (desde las 18:37:02) la reducción comenzó a los 46 s: 6 → 5 (18:37:48), → 4 (18:41:25), → 3 (18:45:33), → 2 (18:49:40). Baja de a una tarea cada ~4 minutos por el enfriamiento de 180 s, a propósito para no quedarse corto si la carga vuelve. Gráfica: `docs/resultados/6_ciclo_completo_tareas.png`.
- **16 nov. Corrección de CVE-2026-4738 desplegada sin cortes.** `scripts/deploy.sh api` (18:50:33 a 18:54:12) construyó la imagen con `apk upgrade`, la publicó y actualizó el servicio con despliegue gradual mientras el escenario `valle` seguía enviando tráfico: **0 errores**. El escaneo de la imagen nueva terminó con **0 vulnerabilidades**. Como ahora se construye con `--provenance=false`, el escaneo aparece directamente en la etiqueta.
- **16 nov. Locust dejó de escribir sus CSV a las 18:42** durante el escenario `valle` (con `--csv-full-history`), igual que el monitor de ECS del mismo proceso; el tráfico siguió, y el resumen final en consola (4.309 solicitudes, 0 fallas) cubre los 25 minutos. El tramo que faltaba del estado de ECS se completó con el registro de un vigilante externo (`docs/resultados/valle/ecs_tareas_vigilante.csv`).

## Costos reales (23 nov 2026)

- La infraestructura quedó encendida del 16 al 23 de noviembre mientras se terminaban el informe y la presentación. Costo real de SIHO Lite: ≈ USD 16,25, USD 2,49 por día en estado estable (estimado: USD 2,7 por día), 100 % pagado con créditos. Detalle en `docs/resultados/costo_real.md`.
- **23 nov. El presupuesto `SIHO-Lite-20USD` nunca avisó.** Síntoma: sin alertas, aunque se gastaron unos USD 16. Causa: AWS Budgets descuenta los créditos por defecto (`IncludeCredit = true`), así que el gasto neto era USD 0. Solución o lección: en una cuenta con créditos, el presupuesto de control debe excluir los créditos para medir lo que se consume.
