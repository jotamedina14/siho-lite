# SIHO Lite

Prototipo del módulo de admisiones, agenda de citas y documentos clínicos del SIHO (E.S.E. Hospital Regional del Fonce, caso académico), desplegado en AWS con ECS Fargate, ALB, RDS PostgreSQL, S3, CloudFront, Cognito y WAF. **Solo datos sintéticos.**

El diseño completo está en [`CLAUDE.md`](CLAUDE.md) y la bitácora en [`docs/bitacora.md`](docs/bitacora.md).

## Correr en local

Requisitos: Docker con Compose, Node.js 22 o superior.

```bash
cp .env.example .env            # y cambia los valores
docker compose up -d --build    # PostgreSQL + almacenamiento S3 local + migraciones + seed + API (puerto 3000)
cd web && npm install && npm run dev   # frontend en http://localhost:5173
```

En local el login es de desarrollo: eliges el rol (`admisiones`, `medico`, `admin`).

### Pruebas

```bash
cd api && npm install && npm test        # requiere `docker compose up -d db`
uv venv .venv && uv pip install --python .venv/bin/python playwright locust boto3 matplotlib pandas
.venv/bin/playwright install chromium
.venv/bin/python scripts/capturas_app.py --base http://localhost:5173 --salida docs/capturas/local
```

## Desplegar y destruir en AWS

Ver la sección de despliegue más abajo (se completa en la fase 2).
