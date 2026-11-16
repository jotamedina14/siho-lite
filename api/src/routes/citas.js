import { Router } from 'express';
import { z } from 'zod';
import { auditar } from '../middleware/audit.js';
import { requireRole, TODOS } from '../middleware/auth.js';
import { HttpError, validar } from '../middleware/errors.js';

const DURACION_MIN = 20; // duración de una cita para validar cruces

const hoyBogota = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

export function citasRouter({ db }) {
  const r = Router();

  // Agenda del día (hora de Colombia), opcionalmente filtrada por profesional.
  r.get('/', requireRole(...TODOS), async (req, res) => {
    const { fecha, profesional } = validar(z.object({
      fecha: z.iso.date().optional(),
      profesional: z.uuid().optional(),
    }), req.query);
    const dia = fecha ?? hoyBogota();
    const params = [`${dia}T00:00:00-05:00`];
    let filtro = '';
    if (profesional) {
      params.push(profesional);
      filtro = 'AND c.profesional_id = $2';
    }
    const { rows } = await db.query(
      `SELECT c.id, c.fecha_hora AS "fechaHora", c.especialidad, c.estado, c.observaciones,
              c.paciente_id AS "pacienteId", pa.nombres || ' ' || pa.apellidos AS paciente,
              c.profesional_id AS "profesionalId", pr.nombres AS profesional
       FROM citas c
       JOIN pacientes pa ON pa.id = c.paciente_id
       JOIN profesionales pr ON pr.id = c.profesional_id
       WHERE c.fecha_hora >= $1::timestamptz AND c.fecha_hora < $1::timestamptz + interval '1 day' ${filtro}
       ORDER BY c.fecha_hora, pr.nombres LIMIT 300`,
      params,
    );
    res.json({ fecha: dia, datos: rows });
  });

  // Agendar: valida que el profesional y el paciente no tengan otra cita programada que se cruce.
  r.post('/', requireRole('admisiones', 'admin'), async (req, res) => {
    const d = validar(z.object({
      pacienteId: z.uuid(),
      profesionalId: z.uuid(),
      fechaHora: z.iso.datetime({ offset: true }),
      observaciones: z.string().trim().max(500).optional(),
    }), req.body);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Serializa agendamientos del mismo profesional para evitar carreras.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [d.profesionalId]);
      const prof = await client.query('SELECT especialidad FROM profesionales WHERE id = $1 AND activo', [d.profesionalId]);
      if (prof.rowCount === 0) throw new HttpError(400, 'profesional_no_disponible');
      const cruce = await client.query(
        `SELECT 1 FROM citas WHERE estado = 'programada'
           AND (profesional_id = $1 OR paciente_id = $2)
           AND fecha_hora > $3::timestamptz - make_interval(mins => $4)
           AND fecha_hora < $3::timestamptz + make_interval(mins => $4)
         LIMIT 1`,
        [d.profesionalId, d.pacienteId, d.fechaHora, DURACION_MIN],
      );
      if (cruce.rowCount > 0) throw new HttpError(409, 'cruce_de_horario');
      const { rows } = await client.query(
        `INSERT INTO citas (paciente_id, profesional_id, fecha_hora, especialidad, observaciones)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, paciente_id AS "pacienteId", profesional_id AS "profesionalId", fecha_hora AS "fechaHora", especialidad, estado`,
        [d.pacienteId, d.profesionalId, d.fechaHora, prof.rows[0].especialidad, d.observaciones ?? null],
      );
      await client.query('COMMIT');
      await auditar(db, req, 'crear', 'cita', rows[0].id);
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  r.patch('/:id', requireRole('admisiones', 'medico'), async (req, res) => {
    const { id } = validar(z.object({ id: z.uuid() }), req.params);
    const d = validar(z.object({
      estado: z.enum(['programada', 'atendida', 'cancelada', 'inasistencia']),
      observaciones: z.string().trim().max(500).optional(),
    }), req.body);
    const { rows } = await db.query(
      `UPDATE citas SET estado = $2, observaciones = COALESCE($3, observaciones) WHERE id = $1
       RETURNING id, fecha_hora AS "fechaHora", especialidad, estado, observaciones`,
      [id, d.estado, d.observaciones ?? null],
    );
    if (rows.length === 0) throw new HttpError(404, 'cita_no_encontrada');
    await auditar(db, req, `cita_${d.estado}`, 'cita', id);
    res.json(rows[0]);
  });

  return r;
}

export function profesionalesRouter({ db }) {
  const r = Router();
  r.get('/', requireRole(...TODOS), async (_req, res) => {
    const { rows } = await db.query(
      'SELECT id, nombres, especialidad, registro_medico AS "registroMedico" FROM profesionales WHERE activo ORDER BY especialidad, nombres',
    );
    res.json({ datos: rows });
  });
  return r;
}
