import fs from 'node:fs';
import pg from 'pg';

// Las columnas DATE se devuelven como texto 'AAAA-MM-DD' para evitar corrimientos por zona horaria.
pg.types.setTypeParser(1082, (v) => v);
// COUNT(*) devuelve bigint; en este volumen cabe en un número de JS.
pg.types.setTypeParser(20, (v) => Number(v));

export function sslOptions(dbConfig) {
  if (!dbConfig.ssl) return false;
  // TLS verificando el certificado con el bundle de la CA de RDS incluido en la imagen.
  return { ca: fs.readFileSync(dbConfig.sslCaPath, 'utf8'), rejectUnauthorized: true };
}

export function createPool(dbConfig, credenciales = {}) {
  return new pg.Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: credenciales.user ?? dbConfig.user,
    password: credenciales.password ?? dbConfig.password,
    ssl: sslOptions(dbConfig),
    max: credenciales.max ?? dbConfig.max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: 'siho-lite-api',
  });
}
