# Diseño técnico: SIHO Lite en AWS
**Actividad 6. Implementación de una aplicación en la nube**
Electiva III: Computación en la Nube 20262, N6 Grupo B. Docente: Ing. Gustavo Adolfo Páramo Hernández.
Autor: Yonathan López Blanco (trabajo individual).
Fecha límite de entrega: 29 de noviembre de 2026.

> **Para Claude Code:** este archivo es la especificación del proyecto. Guárdalo en la raíz del repositorio como `CLAUDE.md` (o `docs/DISENO.md` y referéncialo desde `CLAUDE.md`). Trabaja por fases (sección 9), en orden, y no pases a la siguiente sin cumplir sus criterios de aceptación. Antes de crear cualquier recurso que cueste dinero en AWS, muestra el plan (`terraform plan`) y espera confirmación.

---

## 1. Contexto y relación con la Actividad 4

En la Actividad 4 diseñamos el plan de migración a AWS del sistema SIHO de la E.S.E. Hospital Regional del Fonce (caso de estudio académico). La arquitectura de destino era: aplicación en contenedores sobre **Amazon ECS con Fargate**, **Application Load Balancer** entre dos zonas, **Amazon RDS para PostgreSQL**, documentos clínicos en **Amazon S3**, autoescalado por CPU con una regla programada a las 6:15 a. m. para el pico de consulta externa, y controles alineados con los lineamientos de seguridad del MinTIC.

En la Actividad 6 **implementamos de verdad esa arquitectura** con un prototipo funcional llamado **SIHO Lite**: el módulo de admisiones, agenda de citas y documentos clínicos. No se reescribe todo SIHO; se construye un prototipo que demuestra que la arquitectura propuesta funciona, escala y es segura.

Decisión de lenguaje: el SIHO original es Java, pero el prototipo se construye en **Node.js** (API) y **Python** (pruebas de carga, análisis de métricas y escalador predictivo), que son los lenguajes que domina el autor. Esto se justifica en el informe: la arquitectura es independiente del lenguaje porque la unidad de despliegue es el contenedor.

**Regla de oro: solo datos sintéticos.** Nunca se cargan datos reales de pacientes. Los datos de prueba se generan con Faker (configuración `es_CO`). Esto se declara en el informe como medida de cumplimiento de la Ley 1581 de 2012.

---

## 2. Justificación de la aplicación para la nube

Va al informe, sección "Selección de la aplicación":

- **Escalabilidad:** la carga del hospital es muy variable (pico de 180 usuarios simultáneos entre 6 y 10 a. m., mínima en la noche). La nube permite pagar capacidad solo en el pico.
- **Accesibilidad:** sede principal, sede alterna y portal de pacientes acceden por HTTPS desde cualquier lugar.
- **Costos:** se paga por uso, sin comprar servidores; el prototipo cuesta centavos por hora y se destruye con un solo comando.
- **Disponibilidad y seguridad:** dos zonas de disponibilidad, servicios administrados con cifrado y parches automáticos.

---

## 3. Arquitectura

### 3.1 Diagrama

```mermaid
flowchart LR
  U[Usuarios: admisiones, médicos, admin] -->|HTTPS| CF[Amazon CloudFront]
  WAF[AWS WAF: reglas administradas + límite de tasa] --- CF
  CF -->|/* estático| S3W[S3 frontend privado, OAC]
  CF -->|/api/* + cabecera secreta| ALB[Application Load Balancer<br/>least outstanding requests]
  U -->|login| COG[Amazon Cognito<br/>User Pool + MFA]
  subgraph VPC us-east-1, 2 zonas de disponibilidad
    ALB --> T1[Tarea Fargate AZ-a]
    ALB --> T2[Tarea Fargate AZ-b]
    ALB -.-> TN[Tareas extra 2..6<br/>autoescalado]
    T1 & T2 & TN -->|TLS| RDS[(RDS PostgreSQL 16<br/>subred privada, cifrado KMS)]
  end
  T1 & T2 & TN -->|URL prefirmada| S3D[S3 documentos clínicos<br/>SSE-KMS, versionado, sin acceso público]
  T1 & T2 & TN --> SM[Secrets Manager]
  T1 & T2 & TN --> CW[CloudWatch Logs, métricas, alarmas, dashboard]
  CW --> AAS[Application Auto Scaling<br/>target tracking + programado]
  LAM[Lambda Python<br/>escalador predictivo] --> AAS
  CW --> LAM
  GH[GitHub Actions + OIDC] --> ECR[Amazon ECR<br/>escaneo de imágenes] --> T1
  CT[CloudTrail] & GD[GuardDuty] & BUD[AWS Budgets]
```

Claude Code debe generar además una versión del diagrama como imagen (por ejemplo con la librería `diagrams` de Python y sus íconos oficiales de AWS) para el informe y la presentación: `docs/arquitectura.png`.

### 3.2 Servicios y decisiones

| Capa | Servicio | Configuración | Por qué |
|---|---|---|---|
| Región | us-east-1 | Igual que la Actividad 4 | País con nivel adecuado de protección según la SIC; región más económica |
| Red | VPC propia | 2 AZ; 2 subredes públicas (ALB y tareas) y 2 privadas (RDS) | Aislamiento; la base de datos nunca es accesible desde internet |
| Borde | CloudFront | Origen S3 con OAC y origen ALB para `/api/*`; solo HTTPS (redirige HTTP) | HTTPS gratis sin comprar dominio; caché del frontend |
| Protección | AWS WAF en CloudFront | `AWSManagedRulesCommonRuleSet`, `KnownBadInputs`, `SQLiRuleSet`, regla de límite de tasa por IP (p. ej. 1.000 solicitudes en 5 min) | OWASP Top 10, mitigación de abuso |
| Balanceo | Application Load Balancer | Algoritmo `least_outstanding_requests`; health check `/health` cada 10 s; deregistration delay 30 s; SG que solo admite el prefix list de CloudFront y exige cabecera `X-Origin-Verify` | Balanceo dinámico según la carga real de cada tarea |
| Cómputo | ECS sobre Fargate | 0,25 vCPU / 0,5 GB por tarea; mínimo 2, máximo 6; repartidas en 2 AZ; IP pública pero SG que solo acepta tráfico del ALB | Sin servidores que administrar; sin NAT Gateway para ahorrar costos |
| Base de datos | RDS PostgreSQL 16 | `db.t4g.micro`, 20 GB gp3, Single-AZ, cifrado KMS, `rds.force_ssl=1`, respaldos 7 días, contraseña administrada por Secrets Manager | En producción sería Multi-AZ (Actividad 4); en el prototipo Single-AZ por costo, y se documenta como decisión consciente |
| Archivos | S3 documentos | Bloqueo de acceso público, versionado, SSE-KMS, política que exige TLS, ciclo de vida a Glacier IR a los 30 días | Custodia de documentos clínicos |
| Identidad | Cognito User Pool | Grupos `admin`, `admisiones`, `medico`; MFA TOTP obligatorio para `admin`; política de contraseñas fuerte; managed login | Autenticación sin guardar contraseñas en nuestra base de datos |
| Secretos | Secrets Manager | Credenciales de RDS y cabecera de origen | Nada sensible en código ni en variables planas |
| Imágenes | ECR | Escaneo al publicar, tags inmutables | Detección de vulnerabilidades |
| CI/CD | GitHub Actions | OIDC hacia un rol IAM (sin llaves de larga duración); build, test, scan, push, deploy | Despliegue repetible |
| Observabilidad | CloudWatch | Logs JSON con retención de 30 días, dashboard, alarmas (5xx, latencia p95, CPU, tareas sanas) | Evidencia para las pruebas |
| Auditoría | CloudTrail + GuardDuty | Trail de eventos de gestión; GuardDuty en prueba gratis de 30 días | Trazabilidad y detección de amenazas |
| Costos | AWS Budgets | Presupuesto de USD 20 con alertas al 50 %, 80 % y 100 % | Control del gasto |
| IaC | Terraform | Todo como código, estado local (o S3 + bloqueo), `terraform destroy` al final | Reproducible y portable |

Etiquetas obligatorias en todos los recursos: `Proyecto=SIHO-Lite`, `Ambiente=prototipo`, `Responsable=yonathan-lopez`, `Curso=ElectivaIII`.

---

## 4. La aplicación

### 4.1 Estructura del repositorio

```
siho-lite/
├── CLAUDE.md                  # este diseño
├── README.md                  # cómo correr y desplegar
├── api/                       # Node.js 22 + Express (o Fastify) + TypeScript opcional
│   ├── src/
│   │   ├── app.js / server.js
│   │   ├── config/            # lectura de variables y secretos
│   │   ├── middleware/        # auth JWT Cognito, roles, auditoría, errores, logger
│   │   ├── routes/            # pacientes, citas, admisiones, documentos, reportes, info
│   │   ├── services/          # lógica y acceso a S3
│   │   └── db/                # pool pg, migraciones (node-pg-migrate) y seed
│   ├── test/                  # Vitest/Jest + supertest
│   └── Dockerfile
├── web/                       # React + Vite
├── infra/                     # Terraform por módulos: network, security, data, compute, edge, observability, cicd
├── loadtest/                  # Python: Locust + análisis de métricas
├── scaler/                    # Python: Lambda del escalador predictivo
├── docs/                      # diagramas, capturas, resultados de pruebas
├── docker-compose.yml         # API + PostgreSQL + MinIO para desarrollo local
└── .github/workflows/         # ci.yml, deploy.yml
```

### 4.2 Modelo de datos (PostgreSQL)

- `pacientes`: id (uuid), tipo_documento (CC, TI, RC, CE, PA), numero_documento (único con tipo), nombres, apellidos, fecha_nacimiento, sexo, telefono, email, eps, municipio, creado_en, actualizado_en.
- `profesionales`: id, nombres, especialidad, registro_medico, activo.
- `citas`: id, paciente_id, profesional_id, fecha_hora, especialidad, estado (programada, atendida, cancelada, inasistencia), observaciones.
- `admisiones`: id, paciente_id, servicio (urgencias, consulta_externa, hospitalizacion), motivo, triage (1 a 5, solo urgencias), estado (abierta, cerrada), fecha_ingreso, fecha_egreso.
- `documentos`: id, paciente_id, tipo (orden, resultado_laboratorio, epicrisis, consentimiento, otro), s3_key, nombre_original, content_type, tamano_bytes, sha256, subido_por, subido_en.
- `auditoria`: id, usuario_sub, usuario_email, rol, accion, recurso, recurso_id, ip, user_agent, ocurrido_en. Solo inserción: el rol de base de datos de la aplicación no tiene permiso de UPDATE ni DELETE sobre esta tabla.

Índices sobre documento del paciente, `citas(fecha_hora)`, `citas(profesional_id, fecha_hora)` y `auditoria(ocurrido_en)`.
Seed con Faker `es_CO`: 5.000 pacientes, 30 profesionales, 20.000 citas, 3.000 admisiones.

### 4.3 API REST

Todas las rutas `/api/*` exigen JWT válido de Cognito, salvo `/health`.

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/health` | público | Verifica proceso y conexión a la base; usado por el ALB |
| GET | `/api/info` | todos | Devuelve id de la tarea, zona de disponibilidad y versión (lee el endpoint de metadatos de ECS). **Sirve para demostrar el balanceo en vivo** |
| GET | `/api/pacientes?q=&page=` | admisiones, medico, admin | Búsqueda paginada |
| POST | `/api/pacientes` | admisiones, admin | Crear paciente |
| GET | `/api/pacientes/:id` | admisiones, medico, admin | Detalle; **registra auditoría** |
| PUT | `/api/pacientes/:id` | admisiones, admin | Actualizar |
| GET | `/api/citas?fecha=&profesional=` | todos | Agenda |
| POST | `/api/citas` | admisiones, admin | Agendar; valida que no haya cruce de horario |
| PATCH | `/api/citas/:id` | admisiones, medico | Cambiar estado |
| POST | `/api/admisiones` | admisiones | Abrir admisión |
| PATCH | `/api/admisiones/:id/cerrar` | admisiones, medico | Cerrar admisión |
| POST | `/api/pacientes/:id/documentos` | admisiones, medico | Devuelve URL prefirmada PUT a S3 (5 min, solo PDF/JPG/PNG, máx. 10 MB) y registra el documento |
| GET | `/api/documentos/:id/descarga` | medico, admin | URL prefirmada GET (5 min); **registra auditoría** |
| GET | `/api/reportes/ocupacion?desde=&hasta=` | admin | Agregaciones SQL (citas por especialidad y día, admisiones por servicio). Es la ruta "pesada" para las pruebas de carga |
| GET | `/api/auditoria` | admin | Consulta de trazas |

Reglas de implementación:
- Validación de entrada con `zod`; consultas siempre parametrizadas.
- `helmet`, CORS limitado al dominio de CloudFront, límite de tamaño de body.
- Logs en JSON (`pino`) con `requestId` y `taskId`, **sin datos personales** (no registrar nombres ni documentos).
- Manejo de errores sin filtrar trazas internas al cliente.
- Cierre ordenado ante `SIGTERM` (dejar de aceptar, terminar solicitudes en curso, cerrar el pool) para que el escalado hacia abajo no corte usuarios.
- Conexión a RDS con TLS verificando el certificado de la CA de RDS.
- Validación de JWT con `aws-jwt-verify` (issuer, audience, expiración, grupo).

### 4.4 Frontend (React + Vite)

Pantallas: login (redirección a Cognito), buscador y ficha de paciente, agenda del día, nueva admisión, carga y descarga de documentos, reporte de ocupación (gráficas) y panel de administración con auditoría.
Un **indicador en la barra superior** muestra qué tarea y en qué zona respondió la última solicitud (datos de `/api/info`), útil para el video y la presentación.

### 4.5 Contenedor

Imagen multietapa sobre `node:22-alpine` o distroless, usuario no root, sistema de archivos de solo lectura en la definición de tarea, `HEALTHCHECK`, sin herramientas de compilación en la imagen final. Escaneo con Trivy en CI y con ECR al publicar.

---

## 5. Balanceo de carga dinámico (Rajammal y Chinnadurai, 2025)

Rajammal y Chinnadurai (2025) proponen un balanceo que combina **decisiones adaptativas de corto plazo** con **predicción de la disponibilidad futura de recursos**, en lugar de reglas estáticas. Su modelo usa redes neuronales de impulsos, redes neuronales de grafos temporales y aprendizaje por refuerzo; en un prototipo académico no se entrena ese modelo, pero sí se implementan **los mismos dos niveles** con servicios administrados, y así se explica en el informe:

1. **Nivel reactivo (corto plazo):**
   - El ALB usa `least_outstanding_requests`: cada solicitud va a la tarea con menos solicitudes en curso, no por turno fijo.
   - Health checks retiran tareas que no responden.
   - Application Auto Scaling con dos políticas de *target tracking*: CPU promedio del servicio al 60 % y `ALBRequestCountPerTarget` (valor objetivo a calibrar con las pruebas, inicial 300 por minuto). Enfriamiento: 60 s hacia arriba, 180 s hacia abajo.
2. **Nivel predictivo (tendencia):**
   - Acción programada como en la Actividad 4: a las 6:15 a. m. hora Colombia (11:15 UTC) la capacidad mínima sube a 3; a las 10:30 a. m. vuelve a 2.
   - **Escalador predictivo en Python (Lambda cada 5 min):** lee de CloudWatch las solicitudes por minuto de la última hora, ajusta una regresión lineal o media móvil ponderada, pronostica los próximos 10 minutos y, si el pronóstico supera la capacidad actual, sube el `desiredCount` antes de que llegue la carga. Registra cada decisión como métrica personalizada (`SIHO/Scaler/Prediccion`) para graficarla contra la carga real. Si el tiempo no alcanza, esta parte es opcional y el informe se apoya en la acción programada.

---

## 6. Seguridad: alineación con los lineamientos del MinTIC

Esta tabla va casi tal cual al informe. Los lineamientos son los de seguridad de la información para el uso de servicios en la nube del MinTIC y el MSPI (Resolución 500 de 2021). Verificar la numeración exacta contra el documento que dejó el docente en la plataforma.

| Control del MinTIC / MSPI | Implementación en SIHO Lite | Evidencia para el informe |
|---|---|---|
| Análisis de riesgos antes de llevar información a la nube | Matriz de riesgos del prototipo (heredada de la Actividad 4, ajustada) | Tabla en el informe |
| Clasificación de la información | Datos de salud = sensibles (Ley 1581); en el prototipo solo datos sintéticos | Declaración en el informe |
| Gestión de identidades y acceso, mínimo privilegio | Cognito con grupos y roles; IAM con roles separados (ejecución de tarea, tarea, CI/CD); rol de tarea con acceso solo al bucket de documentos | Captura de políticas IAM |
| Autenticación multifactor | MFA obligatoria en la cuenta raíz y usuarios IAM, y para el grupo `admin` en Cognito | Captura de configuración |
| Cifrado en reposo | KMS en RDS, S3 y logs | Captura de RDS y bucket |
| Cifrado en tránsito | HTTPS en CloudFront, TLS forzado en RDS y política del bucket que niega conexiones sin TLS | Captura de `curl -I` y parámetro `rds.force_ssl` |
| Seguridad de red | Base de datos en subred privada; SG encadenados (CloudFront → ALB → tareas → RDS); WAF | Diagrama y reglas de SG |
| Trazabilidad y registros | CloudTrail, logs de CloudWatch, tabla `auditoria` de solo inserción | Consulta de auditoría y evento de CloudTrail |
| Gestión de vulnerabilidades | Escaneo de imágenes (ECR, Trivy), `npm audit`, Checkov sobre Terraform, OWASP ZAP baseline contra la URL | Reportes en `docs/` |
| Detección y respuesta a incidentes | GuardDuty, alarmas de CloudWatch con notificación SNS al correo | Captura de alarma disparada en la prueba de carga |
| Respaldo y recuperación | Respaldos automáticos de RDS (7 días) y versionado de S3; prueba de restauración a un punto en el tiempo | Captura de la restauración |
| Ubicación de los datos | us-east-1, declarada | Informe |
| Portabilidad y no dependencia | Terraform, contenedores estándar, PostgreSQL estándar | Repositorio |
| Gestión de costos | Budgets, etiquetas, destrucción al terminar | Captura de Budgets y Cost Explorer |

---

## 7. Plan de pruebas

| Tipo | Herramienta | Qué demuestra |
|---|---|---|
| Unitarias e integración | Vitest/Jest + supertest + PostgreSQL en docker | Lógica de negocio, validaciones, permisos por rol (por ejemplo, `medico` no puede crear pacientes: 403) |
| Funcionales de extremo a extremo | Lista de casos manual o Playwright | Flujo completo: login, crear paciente, agendar, admitir, subir y descargar documento |
| Carga | **Locust (Python)** | Escalado y balanceo; tres escenarios abajo |
| Seguridad | OWASP ZAP baseline, Trivy, Checkov, `npm audit`; pruebas manuales (sin token: 401, rol incorrecto: 403, inyección SQL bloqueada por WAF, bucket no accesible públicamente) | Controles funcionando |
| Resiliencia | Detener una tarea a mano durante la carga | El ALB la retira, ECS la reemplaza y no hay errores visibles |
| Recuperación | Restauración de RDS a un punto en el tiempo | Respaldo útil |

Escenarios de Locust (usuarios simulados con token de un usuario de prueba, mezcla 60 % búsquedas, 20 % agenda, 10 % creación, 10 % reportes):
1. **Carga base:** 20 usuarios durante 10 min.
2. **Pico matutino (escalones):** 20 → 60 → 120 → 180 usuarios, 5 min por escalón (refleja los 180 usuarios del caso).
3. **Ráfaga:** de 10 a 200 usuarios en 30 s, sostener 5 min, bajar a 10.

Métricas a recolectar (script Python con `boto3` + `matplotlib` que genera las gráficas en `docs/resultados/`): solicitudes por segundo, latencia p50/p95/p99, tasa de error, número de tareas en el tiempo, CPU promedio, distribución de solicitudes por tarea y predicción contra carga real. Exportar también el CSV y el HTML de Locust.

Criterios de éxito: p95 < 1 s en carga base y < 2 s en el pico; errores < 1 %; el servicio escala sin intervención y vuelve al mínimo tras la carga.

La prueba de carga se lanza desde el computador del estudiante o desde una instancia EC2 pequeña temporal en la misma región (preferible, para no medir la latencia de internet). Avisar antes de crearla.

---

## 8. Costos estimados del prototipo

Precios bajo demanda de us-east-1 (verificar en la calculadora de AWS antes de escribir el informe):

| Recurso | Aprox. USD/mes encendido |
|---|---|
| ALB (hora + LCU bajas) | 18 |
| Fargate, 2 tareas de 0,25 vCPU / 0,5 GB | 18 |
| RDS db.t4g.micro + 20 GB | 14 |
| IPv4 públicas (ALB y tareas, USD 0,005/h cada una) | 15 a 20 |
| WAF (web ACL + reglas) | 9 |
| KMS, Secrets Manager, CloudWatch, ECR | 5 |
| CloudFront, S3, Cognito, Lambda | ~0 (capas gratuitas) |
| **Total** | **~USD 80/mes, unos USD 2,7 por día** |

Del 13 al 29 de noviembre (~17 días) el costo esperado es de unos USD 45, menos si se apaga (servicio ECS a 0 y RDS detenido) en los días en que no se trabaja. Si la cuenta tiene créditos del plan gratuito, se cubren con ellos. **Configurar AWS Budgets antes de crear cualquier otro recurso.** Después de la calificación: `terraform destroy`.

En el informe se compara este costo con el de la arquitectura de producción de la Actividad 4 (USD 1.732,78/mes optimizado) y se explica qué se recortó y por qué (Single-AZ, sin NAT, sin VPN, tareas pequeñas).

---

## 9. Fases de trabajo y criterios de aceptación

| Fase | Fechas | Entregable | Aceptación |
|---|---|---|---|
| 0. Preparación | 13 nov | Cuenta AWS con MFA en raíz, usuario/rol de administración, Budgets, AWS CLI y Terraform instalados, repositorio en GitHub | `aws sts get-caller-identity` funciona; alerta de presupuesto creada |
| 1. App local | 13 a 16 nov | API, base de datos, migraciones, seed, frontend, `docker-compose` | Flujo completo funciona en local; pruebas unitarias en verde |
| 2. Infraestructura | 16 a 18 nov | Terraform de red, seguridad, datos, cómputo, borde, observabilidad | `terraform apply` limpio; `/health` responde por la URL de CloudFront |
| 3. CI/CD | 18 a 19 nov | Workflows de GitHub con OIDC | Un push a `main` despliega una versión nueva sin intervención |
| 4. Seguridad | 19 a 20 nov | Cognito, WAF, KMS, CloudTrail, GuardDuty, alarmas | Checklist de la sección 6 verificado con capturas |
| 5. Escalado | 20 a 21 nov | Políticas de autoescalado, acción programada, Lambda predictiva | Escala con una prueba corta de Locust |
| 6. Pruebas | 22 a 24 nov | Tres escenarios de carga, pruebas de seguridad, resiliencia y restauración; gráficas | Resultados y gráficas en `docs/resultados/` |
| 7. Documentación | 24 a 27 nov | Informe en PDF (APA 7) y presentación | Revisión final contra la rúbrica y las normas APA |
| 8. Entrega | 28 nov | ZIP con informe + presentación subido a la plataforma | Un día de holgura antes del 29 |

### Evidencias que hay que capturar durante el trabajo
Consola de ECS con las tareas en dos AZ; target group con destinos sanos; gráfica de tareas subiendo durante la carga; dashboard de CloudWatch; reglas de WAF y una solicitud bloqueada; bucket con bloqueo de acceso público y cifrado; RDS cifrada y en subred privada; Cognito con MFA; ejecución exitosa de GitHub Actions; reporte de escaneo de la imagen; Budgets; la app funcionando con el indicador de tarea/AZ.

---

## 10. Retos previstos (para la sección "Retos enfrentados")

Registrar en `docs/bitacora.md` cada problema real con fecha, causa y solución. Probables: health checks que fallan por la ruta o el puerto; tareas sin acceso a ECR o Secrets Manager por permisos o red; certificado TLS de RDS; CORS entre CloudFront y la API; tiempos de enfriamiento del autoescalado; tamaño de las tareas frente a la CPU real; costo de las IPv4 públicas y la decisión de no usar NAT.

---

## 11. Estructura del informe (APA 7)

1. Portada (título, autores, programa, curso, docente, fecha) y enlace al repositorio y al video si lo hay.
2. Resumen y palabras clave.
3. Introducción y objetivos.
4. Marco de referencia: NIST (Mell y Grance, 2011), responsabilidad compartida, balanceo dinámico (Rajammal y Chinnadurai, 2025), lineamientos MinTIC.
5. Selección y justificación de la aplicación.
6. Diseño de la arquitectura (diagrama, tabla de servicios, alineación MinTIC).
7. Implementación: decisiones, CI/CD, seguridad, balanceo y escalado, retos enfrentados.
8. Pruebas y resultados (tablas y gráficas).
9. Costos reales frente a estimados.
10. Conclusiones y trabajo futuro.
11. Referencias.
12. Anexos: capturas, enlaces.

Referencias base:
- Rajammal, K., & Chinnadurai, M. (2025). Dynamic load balancing in cloud computing using predictive graph networks and adaptive neural scheduling. *Scientific Reports, 15*. https://doi.org/10.1038/s41598-025-97494-2 (completar número de artículo al revisarlo).
- Ministerio de Tecnologías de la Información y las Comunicaciones. Lineamientos de seguridad de la información para el uso de servicios en la nube (usar la versión indicada por el curso, 2021).
- Ministerio de Tecnologías de la Información y las Comunicaciones. (2021). Resolución 500 de 2021 (MSPI).
- Mell, P., & Grance, T. (2011). *The NIST definition of cloud computing* (SP 800-145). NIST.
- Congreso de la República de Colombia. (2012). Ley Estatutaria 1581 de 2012.
- Documentación oficial de AWS usada (ECS, ALB, Application Auto Scaling, RDS, S3, WAF, Cognito).

---

## 12. Modo de un solo día (prioridades si el tiempo aprieta)

Si el objetivo es terminar en una jornada, hacer en este orden y dejar lo marcado como opcional para el final:
1. Imprescindible: app local funcionando, Terraform con VPC, ALB, ECS Fargate (2 a 6 tareas), RDS, S3, CloudFront, autoescalado por CPU y por solicitudes, acción programada, Budgets.
2. Imprescindible: prueba de carga con Locust (escenario de escalones) y gráficas.
3. Recomendado: Cognito, WAF, CloudTrail, alarmas, escaneo de imagen.
4. Opcional: GitHub Actions con OIDC (se puede desplegar con un script `deploy.sh`), Lambda predictiva, OWASP ZAP, restauración de RDS.

## 13. Instrucciones permanentes para Claude Code

- Responder y comentar en español; nombres de código en inglés o español, pero consistentes.
- Nunca escribir secretos, llaves ni contraseñas en el repositorio; usar `.env.example` y Secrets Manager. Agregar `.gitignore` para `.env`, `*.tfstate*`, `.terraform/`.
- Antes de cualquier `terraform apply` o `destroy`, mostrar el plan y pedir confirmación.
- Mantener `README.md` actualizado con cómo correr en local, desplegar y destruir.
- Cada fase termina con un commit claro y una nota en `docs/bitacora.md` (qué se hizo, decisiones, problemas).
- Preferir la opción más barata que cumpla el diseño; si algo cuesta más de USD 5 al mes y no está en este documento, preguntar primero.
