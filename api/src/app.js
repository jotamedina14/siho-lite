import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { logger } from './logger.js';
import { createAuth, firmarTokenDev, ROLES } from './middleware/auth.js';
import { errorHandler, notFound, validar } from './middleware/errors.js';
import { admisionesRouter } from './routes/admisiones.js';
import { citasRouter, profesionalesRouter } from './routes/citas.js';
import { documentosRouter } from './routes/documentos.js';
import { pacientesRouter } from './routes/pacientes.js';
import { auditoriaRouter, reportesRouter } from './routes/reportes.js';

// Construye la aplicación con sus dependencias inyectadas (facilita las pruebas).
export function createApp({ config, db, storage, taskInfo, estado = { cerrando: false } }) {
  const app = express();
  const auth = createAuth(config.auth);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['X-Task-Id', 'X-AZ', 'X-Request-Id'] }));

  // Identificador de solicitud y cabeceras que muestran qué tarea/AZ respondió (demostración del balanceo).
  app.use((req, res, next) => {
    req.id = req.get('x-amz-cf-id')?.slice(0, 64) ?? req.get('x-request-id')?.slice(0, 64) ?? randomUUID();
    res.set({ 'X-Request-Id': req.id, 'X-Task-Id': taskInfo.taskId, 'X-AZ': taskInfo.az });
    next();
  });

  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.id,
    customProps: () => ({ taskId: taskInfo.taskId, az: taskInfo.az }),
    autoLogging: { ignore: (req) => req.url === '/health' },
    serializers: {
      // Solo método y ruta sin query string: la búsqueda puede contener datos personales.
      req: (req) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));

  app.use(express.json({ limit: '100kb' }));

  // Health check del ALB: proceso vivo y base de datos alcanzable.
  app.get('/health', async (_req, res) => {
    if (estado.cerrando) return res.status(503).json({ status: 'cerrando' });
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok', version: config.version });
    } catch {
      res.status(503).json({ status: 'error', db: 'sin_conexion' });
    }
  });

  // Solo en desarrollo local: emite tokens de prueba para no depender de Cognito.
  if (config.auth.mode === 'dev') {
    app.post('/dev/token', async (req, res) => {
      const { rol } = validar(z.object({ rol: z.enum(ROLES) }), req.body);
      const token = await firmarTokenDev(config.auth.devSecret, { sub: `dev-${rol}`, email: `${rol}@siho.local`, grupos: [rol] });
      res.json({ token, rol });
    });
  }

  const api = express.Router();
  api.use(auth.authenticate);
  api.get('/info', (req, res) => res.json({
    ...taskInfo,
    version: config.version,
    usuario: { email: req.user.email, grupos: req.user.grupos },
    hora: new Date().toISOString(),
  }));
  api.use('/pacientes', pacientesRouter({ db }));
  api.use('/citas', citasRouter({ db }));
  api.use('/profesionales', profesionalesRouter({ db }));
  api.use('/admisiones', admisionesRouter({ db }));
  api.use('/reportes', reportesRouter({ db }));
  api.use('/auditoria', auditoriaRouter({ db }));
  api.use('/', documentosRouter({ db, storage }));
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler);

  app.locals.auth = auth;
  return app;
}
