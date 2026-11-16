import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { HttpError, validar } from '../middleware/errors.js';

const DIA_MS = 86_400_000;

export function reportesRouter({ db }) {
  const r = Router();

  // Ruta "pesada" para las pruebas de carga: agregaciones sobre citas y admisiones.
  r.get('/ocupacion', requireRole('admin'), async (req, res) => {
    const q = validar(z.object({ desde: z.iso.date().optional(), hasta: z.iso.date().optional() }), req.query);
    const hasta = q.hasta ?? new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
    const desde = q.desde ?? new Date(new Date(hasta).getTime() - 30 * DIA_MS).toISOString().slice(0, 10);
    if (desde > hasta) throw new HttpError(400, 'rango_invalido');
    if (new Date(hasta) - new Date(desde) > 366 * DIA_MS) throw new HttpError(400, 'rango_maximo_un_anio');
    const rango = [`${desde}T00:00:00-05:00`, `${hasta}T00:00:00-05:00`];

    const [porDia, porEspecialidad, porEstado, porServicio] = await Promise.all([
      db.query(
        `SELECT to_char(fecha_hora AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS dia, count(*) AS citas,
                count(*) FILTER (WHERE estado = 'atendida') AS atendidas,
                count(*) FILTER (WHERE estado = 'inasistencia') AS inasistencias
         FROM citas WHERE fecha_hora >= $1::timestamptz AND fecha_hora < $2::timestamptz + interval '1 day'
         GROUP BY 1 ORDER BY 1`, rango),
      db.query(
        `SELECT especialidad, count(*) AS citas,
                round(100.0 * count(*) FILTER (WHERE estado = 'inasistencia') / NULLIF(count(*), 0), 1) AS "pctInasistencia"
         FROM citas WHERE fecha_hora >= $1::timestamptz AND fecha_hora < $2::timestamptz + interval '1 day'
         GROUP BY especialidad ORDER BY citas DESC`, rango),
      db.query(
        `SELECT estado, count(*) AS citas FROM citas
         WHERE fecha_hora >= $1::timestamptz AND fecha_hora < $2::timestamptz + interval '1 day'
         GROUP BY estado ORDER BY citas DESC`, rango),
      db.query(
        `SELECT servicio, count(*) AS admisiones, count(*) FILTER (WHERE estado = 'abierta') AS abiertas,
                round(avg(extract(epoch FROM (COALESCE(fecha_egreso, now()) - fecha_ingreso)) / 3600)::numeric, 1) AS "horasPromedio"
         FROM admisiones WHERE fecha_ingreso >= $1::timestamptz AND fecha_ingreso < $2::timestamptz + interval '1 day'
         GROUP BY servicio ORDER BY admisiones DESC`, rango),
    ]);

    res.json({
      desde, hasta,
      citasPorDia: porDia.rows,
      citasPorEspecialidad: porEspecialidad.rows.map((f) => ({ ...f, pctInasistencia: Number(f.pctInasistencia) })),
      citasPorEstado: porEstado.rows,
      admisionesPorServicio: porServicio.rows.map((f) => ({ ...f, horasPromedio: Number(f.horasPromedio) })),
    });
  });

  return r;
}

export function auditoriaRouter({ db }) {
  const r = Router();
  r.get('/', requireRole('admin'), async (req, res) => {
    const q = validar(z.object({
      page: z.coerce.number().int().min(1).max(500).default(1),
      recurso: z.string().max(50).optional(),
      accion: z.string().max(50).optional(),
    }), req.query);
    const filtros = [];
    const params = [];
    if (q.recurso) { params.push(q.recurso); filtros.push(`recurso = $${params.length}`); }
    if (q.accion) { params.push(q.accion); filtros.push(`accion = $${params.length}`); }
    params.push(50, (q.page - 1) * 50);
    const { rows } = await db.query(
      `SELECT id, usuario_email AS "usuarioEmail", rol, accion, recurso, recurso_id AS "recursoId", ip, ocurrido_en AS "ocurridoEn"
       FROM auditoria ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
       ORDER BY ocurrido_en DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ datos: rows, pagina: q.page });
  });
  return r;
}
