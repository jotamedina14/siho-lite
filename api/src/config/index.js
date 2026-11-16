// Configuración leída de variables de entorno.
// En AWS, ECS inyecta los secretos (contraseñas de base de datos) desde Secrets Manager
// como variables de entorno; nunca se escriben en el código ni en el repositorio.

const env = process.env;

const lista = (valor, porDefecto = '') =>
  (valor ?? porDefecto)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// validarAuth=false para scripts (migraciones, seed) que no atienden solicitudes.
export function loadConfig({ validarAuth = true } = {}) {
  const config = {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: Number(env.PORT ?? 3000),
    version: env.APP_VERSION ?? 'dev',
    // Saltos de proxy de confianza: CloudFront + ALB = 2. En local, 0.
    trustProxy: Number(env.TRUST_PROXY ?? 0),
    corsOrigins: lista(env.CORS_ORIGINS, 'http://localhost:5173'),
    db: {
      host: env.DB_HOST ?? 'localhost',
      port: Number(env.DB_PORT ?? 5432),
      database: env.DB_NAME ?? 'siho',
      user: env.DB_USER ?? 'siho_app',
      password: env.DB_PASSWORD,
      ssl: env.DB_SSL === 'true',
      sslCaPath: env.DB_SSL_CA ?? new URL('../../certs/rds-global-bundle.pem', import.meta.url).pathname,
      max: Number(env.DB_POOL_MAX ?? 10),
    },
    // Credenciales de administración: solo las recibe la tarea de migraciones, no la API.
    dbAdmin: {
      user: env.DB_ADMIN_USER,
      password: env.DB_ADMIN_PASSWORD,
    },
    auth: {
      mode: env.AUTH_MODE ?? 'cognito',
      userPoolId: env.COGNITO_USER_POOL_ID,
      clientIds: lista(env.COGNITO_CLIENT_IDS),
      devSecret: env.DEV_JWT_SECRET,
    },
    s3: {
      bucket: env.DOCS_BUCKET,
      region: env.AWS_REGION ?? 'us-east-1',
      // Solo para desarrollo local con MinIO.
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    },
  };

  if (!validarAuth) return config;
  if (config.auth.mode === 'dev' && config.nodeEnv === 'production') {
    throw new Error('AUTH_MODE=dev no está permitido con NODE_ENV=production');
  }
  if (config.auth.mode === 'dev' && !config.auth.devSecret) {
    throw new Error('AUTH_MODE=dev requiere DEV_JWT_SECRET');
  }
  if (config.auth.mode === 'cognito' && (!config.auth.userPoolId || config.auth.clientIds.length === 0)) {
    throw new Error('AUTH_MODE=cognito requiere COGNITO_USER_POOL_ID y COGNITO_CLIENT_IDS');
  }
  return config;
}
