import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, codigo, detalle) {
    super(codigo);
    this.status = status;
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

export function validar(esquema, datos) {
  return esquema.parse(datos);
}

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'no_encontrado'));
}

// Manejo de errores: nunca se envían trazas internas al cliente.
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'datos_invalidos',
      detalle: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.codigo, ...(err.detalle ? { detalle: err.detalle } : {}) });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'cuerpo_demasiado_grande' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'json_invalido' });
  // Errores de PostgreSQL conocidos
  if (err.code === '23505') return res.status(409).json({ error: 'registro_duplicado' });
  if (err.code === '23503') return res.status(400).json({ error: 'referencia_invalida' });
  if (err.code === '23514') return res.status(400).json({ error: 'regla_de_datos_incumplida' });

  req.log?.error({ err }, 'error no controlado');
  return res.status(500).json({ error: 'error_interno', requestId: req.id });
}
