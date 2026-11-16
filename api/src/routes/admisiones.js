import { Router } from 'express';
import { z } from 'zod';
import { auditar } from '../middleware/audit.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, validar } from '../middleware/errors.js';

const SELECT = `a.id, a.paciente_id AS "pacienteId", a.servicio, a.motivo, a.triage, a.estado,
  a.fecha_ingreso AS "fechaIngreso", a.fecha_egreso AS "fechaEgreso"`;

export function admisionesRouter({ db }) {
  const r = Router();

  // Listado de admisiones (por defecto las abiertas), para el tablero de admisiones.
  r.get('/', requireRole('admisiones', 'medico', 'admin'), async (req, res) => {
    const { estado } = validar(z.object({ estado: z.enum(['abierta', 'cerrada']).default('abierta') }), req.query);
    const { rows } = await db.query(
      `SELECT ${SELECT}, p.nombres || ' ' || p.apellidos AS paciente
       FROM admisiones a JOIN pacientes p ON p.id = a.paciente_id
       WHERE a.estado = $1 ORDER BY a.fecha_ingreso DESC LIMIT 100`,
      [estado],
    );
    res.json({ datos: rows });
  });

  r.post('/', requireRole('admisiones'), async (req, res) => {
    const d = validar(z.object({
      pacienteId: z.uuid(),
      servicio: z.enum(['urgencias', 'consulta_externa', 'hospitalizacion']),
      motivo: z.string().trim().min(3).max(500),
      triage: z.number().int().min(1).max(5).optional(),
    }).refine((a) => (a.servicio === 'urgencias') === (a.triage !== undefined), {
      message: 'el triage es obligatorio en urgencias y no aplica en otros servicios',
      path: ['triage'],
    }), req.body);

    const abierta = await db.query("SELECT 1 FROM admisiones WHERE paciente_id = $1 AND estado = 'abierta'", [d.pacienteId]);
    if (abierta.rowCount > 0) throw new HttpError(409, 'paciente_con_admision_abierta');

    const { rows } = await db.query(
      `INSERT INTO admisiones AS a (paciente_id, servicio, motivo, triage) VALUES ($1, $2, $3, $4) RETURNING ${SELECT}`,
      [d.pacienteId, d.servicio, d.motivo, d.triage ?? null],
    );
    await auditar(db, req, 'abrir', 'admision', rows[0].id);
    res.status(201).json(rows[0]);
  });

  r.patch('/:id/cerrar', requireRole('admisiones', 'medico'), async (req, res) => {
    const { id } = validar(z.object({ id: z.uuid() }), req.params);
    const { rows } = await db.query(
      `UPDATE admisiones AS a SET estado = 'cerrada', fecha_egreso = now()
       WHERE id = $1 AND estado = 'abierta' RETURNING ${SELECT}`,
      [id],
    );
    if (rows.length === 0) {
      const existe = await db.query('SELECT 1 FROM admisiones WHERE id = $1', [id]);
      throw existe.rowCount ? new HttpError(409, 'admision_ya_cerrada') : new HttpError(404, 'admision_no_encontrada');
    }
    await auditar(db, req, 'cerrar', 'admision', id);
    res.json(rows[0]);
  });

  return r;
}
