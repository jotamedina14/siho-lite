// Ejecuta las migraciones SQL pendientes y configura el rol de la aplicación con mínimo privilegio.
// Se conecta con las credenciales de administración (DB_ADMIN_USER / DB_ADMIN_PASSWORD),
// que solo recibe la tarea de migraciones; la API corre con el rol limitado.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/index.js';
import { logger } from '../logger.js';
import { createPool } from './pool.js';

const DIR_MIGRACIONES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_ID = 7_202_611; // candado consultivo para que dos procesos no migren a la vez

const TABLAS_APP = ['pacientes', 'profesionales', 'citas', 'admisiones', 'documentos'];

export async function migrate({ dbConfig, admin, appUser, appPassword }) {
  const pool = createPool(dbConfig, { ...admin, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nombre varchar(200) PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`);

    const { rows } = await client.query('SELECT nombre FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nombre));
    const archivos = (await fs.readdir(DIR_MIGRACIONES)).filter((f) => f.endsWith('.sql')).sort();

    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = await fs.readFile(path.join(DIR_MIGRACIONES, archivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
        logger.info({ archivo }, 'migración aplicada');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    // Rol de la aplicación: puede leer y escribir datos clínicos, pero no borrarlos,
    // y sobre auditoría solo puede consultar e insertar (registro inalterable).
    const rol = client.escapeIdentifier(appUser);
    const existe = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
    if (existe.rowCount === 0) await client.query(`CREATE ROLE ${rol} LOGIN`);
    await client.query(`ALTER ROLE ${rol} WITH LOGIN PASSWORD ${client.escapeLiteral(appPassword)}`);
    await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(dbConfig.database)} TO ${rol}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${rol}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${rol}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON ${TABLAS_APP.join(', ')} TO ${rol}`);
    await client.query(`GRANT SELECT, INSERT ON auditoria TO ${rol}`);
    await client.query(`GRANT USAGE ON SEQUENCE auditoria_id_seq TO ${rol}`);
    logger.info({ rol: appUser }, 'permisos del rol de aplicación configurados');

    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecución directa: node src/db/migrate.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig({ validarAuth: false });
  migrate({
    dbConfig: config.db,
    admin: config.dbAdmin,
    appUser: config.db.user,
    appPassword: config.db.password,
  })
    .then(() => logger.info('migraciones completas'))
    .catch((err) => {
      logger.error({ err }, 'fallo en migraciones');
      process.exit(1);
    });
}
