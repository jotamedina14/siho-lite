import { Router } from 'express';
import { z } from 'zod';
import { auditar } from '../middleware/audit.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, validar } from '../middleware/errors.js';

const TAMANO_PAGINA = 20;

const pacienteBase = z.object({
  tipoDocumento: z.enum(['CC', 'TI', 'RC', 'CE', 'PA']),
  numeroDocumento: z.string().trim().regex(/^[A-Za-z0-9]{3,20}$/, 'documento inválido'),
  nombres: z.string().trim().min(1).max(100),
  apellidos: z.string().trim().min(1).max(100),
  fechaNacimiento: z.iso.date(),
  sexo: z.enum(['F', 'M', 'I']),
  telefono: z.string().trim().regex(/^\+?\d{7,15}$/, 'teléfono inválido').optional(),
  email: z.email().max(150).optional(),
  eps: z.string().trim().max(80).optional(),
  municipio: z.string().trim().max(80).optional(),
});

const COLUMNAS = {
  tipoDocumento: 'tipo_documento', numeroDocumento: 'numero_documento', nombres: 'nombres', apellidos: 'apellidos',
  fechaNacimiento: 'fecha_nacimiento', sexo: 'sexo', telefono: 'telefono', email: 'email', eps: 'eps', municipio: 'municipio',
};

const SELECT_PACIENTE = `id, tipo_documento AS "tipoDocumento", numero_documento AS "numeroDocumento", nombres, apellidos,
  fecha_nacimiento AS "fechaNacimiento", sexo, telefono, email, eps, municipio, creado_en AS "creadoEn", actualizado_en AS "actualizadoEn"`;

const idParam = z.object({ id: z.uuid() });

export function pacientesRouter({ db }) {
  const r = Router();

  r.get('/', requireRole('admisiones', 'medico', 'admin'), async (req, res) => {
    const { q, page } = validar(z.object({
      q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).max(500).default(1),
    }), req.query);
    const params = [];
    let where = '';
    if (q) {
      params.push(`${q.toLowerCase()}%`);
      where = /^\d+$/.test(q)
        ? 'WHERE numero_documento LIKE $1'
        : 'WHERE lower(apellidos) LIKE $1 OR lower(nombres) LIKE $1';
    }
    params.push(TAMANO_PAGINA, (page - 1) * TAMANO_PAGINA);
    const { rows } = await db.query(
      `SELECT ${SELECT_PACIENTE}, count(*) OVER () AS total FROM pacientes ${where}
       ORDER BY apellidos, nombres LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = rows[0]?.total ?? 0;
    res.json({ datos: rows.map(({ total: _t, ...p }) => p), pagina: page, tamanoPagina: TAMANO_PAGINA, total });
  });

  r.post('/', requireRole('admisiones', 'admin'), async (req, res) => {
    const datos = validar(pacienteBase, req.body);
    const campos = Object.keys(datos);
    const { rows } = await db.query(
      `INSERT INTO pacientes (${campos.map((c) => COLUMNAS[c]).join(', ')})
       VALUES (${campos.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${SELECT_PACIENTE}`,
      campos.map((c) => datos[c]),
    );
    await auditar(db, req, 'crear', 'paciente', rows[0].id);
    res.status(201).json(rows[0]);
  });

  // Ficha del paciente: datos, citas recientes, admisiones y documentos. Registra auditoría.
  r.get('/:id', requireRole('admisiones', 'medico', 'admin'), async (req, res) => {
    const { id } = validar(idParam, req.params);
    const { rows } = await db.query(`SELECT ${SELECT_PACIENTE} FROM pacientes WHERE id = $1`, [id]);
    if (rows.length === 0) throw new HttpError(404, 'paciente_no_encontrado');
    const [citas, admisiones, documentos] = await Promise.all([
      db.query(`SELECT c.id, c.fecha_hora AS "fechaHora", c.especialidad, c.estado, p.nombres AS profesional
                FROM citas c JOIN profesionales p ON p.id = c.profesional_id
                WHERE c.paciente_id = $1 ORDER BY c.fecha_hora DESC LIMIT 20`, [id]),
      db.query(`SELECT id, servicio, motivo, triage, estado, fecha_ingreso AS "fechaIngreso", fecha_egreso AS "fechaEgreso"
                FROM admisiones WHERE paciente_id = $1 ORDER BY fecha_ingreso DESC LIMIT 10`, [id]),
      db.query(`SELECT id, tipo, nombre_original AS "nombreOriginal", content_type AS "contentType",
                tamano_bytes AS "tamanoBytes", subido_por AS "subidoPor", subido_en AS "subidoEn"
                FROM documentos WHERE paciente_id = $1 ORDER BY subido_en DESC`, [id]),
    ]);
    await auditar(db, req, 'consultar', 'paciente', id);
    res.json({ ...rows[0], citas: citas.rows, admisiones: admisiones.rows, documentos: documentos.rows });
  });

  r.put('/:id', requireRole('admisiones', 'admin'), async (req, res) => {
    const { id } = validar(idParam, req.params);
    const datos = validar(pacienteBase.partial().refine((d) => Object.keys(d).length > 0, 'sin cambios'), req.body);
    const campos = Object.keys(datos);
    const { rows } = await db.query(
      `UPDATE pacientes SET ${campos.map((c, i) => `${COLUMNAS[c]} = $${i + 2}`).join(', ')}, actualizado_en = now()
       WHERE id = $1 RETURNING ${SELECT_PACIENTE}`,
      [id, ...campos.map((c) => datos[c])],
    );
    if (rows.length === 0) throw new HttpError(404, 'paciente_no_encontrado');
    await auditar(db, req, 'actualizar', 'paciente', id);
    res.json(rows[0]);
  });

  return r;
}
