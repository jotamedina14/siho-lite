import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createPool } from './db/pool.js';
import { logger } from './logger.js';
import { createStorage } from './services/storage.js';
import { obtenerInfoTarea } from './services/taskInfo.js';

const config = loadConfig();
const db = createPool(config.db);
const storage = createStorage(config.s3);
const taskInfo = await obtenerInfoTarea();
const estado = { cerrando: false };

const app = createApp({ config, db, storage, taskInfo, estado });
await app.locals.auth.hydrate().catch((err) => logger.warn({ err }, 'no se pudieron precargar las llaves JWKS'));

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, taskId: taskInfo.taskId, az: taskInfo.az, version: config.version }, 'API SIHO Lite escuchando');
});
// Mayor que el idle timeout del ALB (60 s) para que el ALB cierre primero las conexiones.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// Cierre ordenado: cuando ECS escala hacia abajo envía SIGTERM. Se deja de aceptar conexiones,
// se terminan las solicitudes en curso y se cierra el pool, para no cortar usuarios.
async function cerrar(senal) {
  if (estado.cerrando) return;
  estado.cerrando = true;
  logger.info({ senal }, 'cierre ordenado iniciado');
  const forzar = setTimeout(() => {
    logger.warn('cierre forzado por tiempo');
    process.exit(1);
  }, 25_000);
  forzar.unref();
  server.close(async () => {
    await db.end().catch(() => {});
    logger.info('cierre ordenado completo');
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => cerrar('SIGTERM'));
process.on('SIGINT', () => cerrar('SIGINT'));
