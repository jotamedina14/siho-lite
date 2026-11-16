# syntax=docker/dockerfile:1
# Imagen multietapa: dependencias de producción y certificado de RDS en etapas separadas;
# la imagen final no tiene npm, herramientas de compilación ni código de pruebas.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM alpine:3.22 AS certs
# Bundle de autoridades certificadoras de Amazon RDS para verificar TLS hacia la base de datos.
RUN wget -q -O /rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# Parches de seguridad del sistema base (p. ej. CVE-2026-4738 en zlib, detectado por el escaneo de ECR)
# y se quitan npm, npx y yarn de la imagen final: no se necesitan en ejecución.
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=certs --chown=root:root /rds-global-bundle.pem ./certs/rds-global-bundle.pem
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
# Usuario sin privilegios (el código es de root y solo lectura para él).
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1
CMD ["node", "src/server.js"]
