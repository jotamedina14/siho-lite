import pino from 'pino';

// Logs en JSON para CloudWatch. Nunca se registran datos personales:
// se redactan cabeceras sensibles y la URL se guarda sin query string
// (la búsqueda ?q= puede contener nombres o documentos).
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'siho-lite-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-origin-verify"]', '*.password'],
    censor: '[REDACTADO]',
  },
});
