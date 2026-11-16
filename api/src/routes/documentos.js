import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { auditar } from '../middleware/audit.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, validar } from '../middleware/errors.js';
import { TAMANO_MAXIMO, TIPOS_PERMITIDOS } from '../services/storage.js';

export function documentosRouter({ db, storage }) {
  const r = Router();

  // Registra el documento y devuelve una URL prefirmada PUT (5 min) para subirlo directo a S3.
  r.post('/pacientes/:id/documentos', requireRole('admisiones', 'medico'), async (req, res) => {
    const { id: pacienteId } = validar(z.object({ id: z.uuid() }), req.params);
    const d = validar(z.object({
      tipo: z.enum(['orden', 'resultado_laboratorio', 'epicrisis', 'consentimiento', 'otro']),
      nombre: z.string().trim().min(1).max(255),
      contentType: z.enum(Object.keys(TIPOS_PERMITIDOS)),
      tamanoBytes: z.number().int().positive().max(TAMANO_MAXIMO, 'máximo 10 MB'),
      sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 en hexadecimal'),
    }), req.body);

    const paciente = await db.query('SELECT 1 FROM pacientes WHERE id = $1', [pacienteId]);
    if (paciente.rowCount === 0) throw new HttpError(404, 'paciente_no_encontrado');

    const docId = randomUUID();
    const key = `pacientes/${pacienteId}/${docId}${TIPOS_PERMITIDOS[d.contentType]}`;
    const subida = await storage.urlSubida({ key, contentType: d.contentType, sha256Hex: d.sha256 });
    const { rows } = await db.query(
      `INSERT INTO documentos (id, paciente_id, tipo, s3_key, nombre_original, content_type, tamano_bytes, sha256, subido_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, tipo, nombre_original AS "nombreOriginal", content_type AS "contentType", tamano_bytes AS "tamanoBytes", subido_en AS "subidoEn"`,
      [docId, pacienteId, d.tipo, key, d.nombre, d.contentType, d.tamanoBytes, d.sha256, req.user.email ?? req.user.sub],
    );
    await auditar(db, req, 'subir', 'documento', docId);
    res.status(201).json({ documento: rows[0], subida });
  });

  // URL prefirmada GET (5 min). Registra auditoría de acceso al documento.
  r.get('/documentos/:id/descarga', requireRole('medico', 'admin'), async (req, res) => {
    const { id } = validar(z.object({ id: z.uuid() }), req.params);
    const { rows } = await db.query('SELECT s3_key, nombre_original FROM documentos WHERE id = $1', [id]);
    if (rows.length === 0) throw new HttpError(404, 'documento_no_encontrado');
    const url = await storage.urlDescarga({ key: rows[0].s3_key, nombre: rows[0].nombre_original });
    await auditar(db, req, 'descargar', 'documento', id);
    res.json({ url, expiraEnSegundos: 300 });
  });

  return r;
}
