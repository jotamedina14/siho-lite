// Pruebas de integración contra PostgreSQL real (base siho_test del docker-compose local).
// Requisito: `docker compose up -d db` en la raíz del repositorio.
import { createHash } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { firmarTokenDev } from '../src/middleware/auth.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { createStorage } from '../src/services/storage.js';

process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));

const SECRETO = 'secreto-de-pruebas-que-no-se-usa-en-ningun-otro-lado';
const dbConfig = { host: 'localhost', port: 5432, database: 'siho_test', user: 'siho_app', password: process.env.DB_APP_PASSWORD, ssl: false, max: 5 };
const admin = { user: 'siho_admin', password: process.env.POSTGRES_ADMIN_PASSWORD };
const config = {
  version: 'test', trustProxy: 0, corsOrigins: ['http://localhost:5173'],
  auth: { mode: 'dev', devSecret: SECRETO },
};

let app; let db; let adminDb; const tokens = {}; let profesionalId;

const auth = (rol) => ({ authorization: `Bearer ${tokens[rol]}` });
const pacienteValido = (n) => ({
  tipoDocumento: 'CC', numeroDocumento: `5000${n}`, nombres: 'Paciente', apellidos: 'De Prueba',
  fechaNacimiento: '1985-03-10', sexo: 'M', municipio: 'Socorro',
});

beforeAll(async () => {
  await migrate({ dbConfig, admin, appUser: 'siho_app', appPassword: process.env.DB_APP_PASSWORD });
  adminDb = createPool(dbConfig, admin);
  await adminDb.query('TRUNCATE auditoria, documentos, admisiones, citas, profesionales, pacientes');
  const prof = await adminDb.query(
    "INSERT INTO profesionales (nombres, especialidad, registro_medico) VALUES ('Dra. Prueba', 'Pediatría', 'RM-TEST1') RETURNING id",
  );
  profesionalId = prof.rows[0].id;
  db = createPool(dbConfig);
  process.env.AWS_ACCESS_KEY_ID = 'prueba';
  process.env.AWS_SECRET_ACCESS_KEY = 'prueba';
  const storage = createStorage({ bucket: 'bucket-prueba', region: 'us-east-1' });
  app = createApp({ config, db, storage, taskInfo: { taskId: 'tarea-test', az: 'us-east-1a' } });
  for (const rol of ['admin', 'admisiones', 'medico']) {
    tokens[rol] = await firmarTokenDev(SECRETO, { sub: `sub-${rol}`, email: `${rol}@prueba.local`, grupos: [rol] });
  }
});

afterAll(async () => {
  await db?.end();
  await adminDb?.end();
});

describe('salud y autenticación', () => {
  it('GET /health responde ok con la base conectada', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(res.headers['x-task-id']).toBe('tarea-test');
  });

  it('rechaza /api sin token (401)', async () => {
    expect((await request(app).get('/api/pacientes')).status).toBe(401);
  });

  it('rechaza un token con firma inválida (401)', async () => {
    const falso = await firmarTokenDev('otro-secreto', { sub: 'x', email: 'x', grupos: ['admin'] });
    const res = await request(app).get('/api/info').set('authorization', `Bearer ${falso}`);
    expect(res.status).toBe(401);
  });

  it('/api/info devuelve la tarea y la zona que respondió', async () => {
    const res = await request(app).get('/api/info').set(auth('medico'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ taskId: 'tarea-test', az: 'us-east-1a' });
  });
});

describe('pacientes', () => {
  it('médico no puede crear pacientes (403)', async () => {
    const res = await request(app).post('/api/pacientes').set(auth('medico')).send(pacienteValido(1));
    expect(res.status).toBe(403);
  });

  it('admisiones crea un paciente y no permite duplicar el documento', async () => {
    const ok = await request(app).post('/api/pacientes').set(auth('admisiones')).send(pacienteValido(2));
    expect(ok.status).toBe(201);
    const dup = await request(app).post('/api/pacientes').set(auth('admisiones')).send(pacienteValido(2));
    expect(dup.status).toBe(409);
  });

  it('valida la entrada (400)', async () => {
    const res = await request(app).post('/api/pacientes').set(auth('admisiones')).send({ ...pacienteValido(3), tipoDocumento: 'XX' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('datos_invalidos');
  });

  it('consultar la ficha registra auditoría', async () => {
    const { body: p } = await request(app).post('/api/pacientes').set(auth('admisiones')).send(pacienteValido(4));
    const res = await request(app).get(`/api/pacientes/${p.id}`).set(auth('medico'));
    expect(res.status).toBe(200);
    const aud = await adminDb.query("SELECT * FROM auditoria WHERE recurso_id = $1 AND accion = 'consultar'", [p.id]);
    expect(aud.rowCount).toBe(1);
    expect(aud.rows[0].usuario_email).toBe('medico@prueba.local');
  });
});

describe('citas y admisiones', () => {
  it('no permite agendar dos citas cruzadas para el mismo profesional (409)', async () => {
    const { body: p1 } = await request(app).post('/api/pacientes').set(auth('admisiones')).send(pacienteValido(5));
    const { body: p2 } = await request(app).post('/api/pacientes').set(auth('admisiones')).send(pacienteValido(6));
    const fechaHora = '2027-02-01T08:00:00-05:00';
    const a = await request(app).post('/api/citas').set(auth('admisiones')).send({ pacienteId: p1.id, profesionalId, fechaHora });
    expect(a.status).toBe(201);
    const b = await request(app).post('/api/citas').set(auth('admisiones'))
      .send({ pacienteId: p2.id, profesionalId, fechaHora: '2027-02-01T08:10:00-05:00' });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('cruce_de_horario');
  });

  it('urgencias exige triage', async () => {
    const { body: p } = await request(app).post('/api/pacientes').set(auth('admisiones')).send(pacienteValido(7));
    const sin = await request(app).post('/api/admisiones').set(auth('admisiones')).send({ pacienteId: p.id, servicio: 'urgencias', motivo: 'Fiebre' });
    expect(sin.status).toBe(400);
    const con = await request(app).post('/api/admisiones').set(auth('admisiones')).send({ pacienteId: p.id, servicio: 'urgencias', motivo: 'Fiebre', triage: 3 });
    expect(con.status).toBe(201);
    const cerrar = await request(app).patch(`/api/admisiones/${con.body.id}/cerrar`).set(auth('medico'));
    expect(cerrar.status).toBe(200);
    expect(cerrar.body.estado).toBe('cerrada');
    const otraVez = await request(app).patch(`/api/admisiones/${con.body.id}/cerrar`).set(auth('medico'));
    expect(otraVez.status).toBe(409);
  });
});

describe('documentos', () => {
  it('entrega URL prefirmada PUT con checksum y solo permite PDF/JPG/PNG', async () => {
    const { body: p } = await request(app).post('/api/pacientes').set(auth('admisiones')).send(pacienteValido(8));
    const sha256 = createHash('sha256').update('contenido').digest('hex');
    const base = { tipo: 'orden', nombre: 'orden.pdf', contentType: 'application/pdf', tamanoBytes: 1234, sha256 };
    const ok = await request(app).post(`/api/pacientes/${p.id}/documentos`).set(auth('medico')).send(base);
    expect(ok.status).toBe(201);
    expect(ok.body.subida.url).toContain('X-Amz-Signature');
    expect(ok.body.subida.cabeceras['x-amz-checksum-sha256']).toBeTruthy();
    const exe = await request(app).post(`/api/pacientes/${p.id}/documentos`).set(auth('medico')).send({ ...base, contentType: 'application/x-msdownload' });
    expect(exe.status).toBe(400);
    const grande = await request(app).post(`/api/pacientes/${p.id}/documentos`).set(auth('medico')).send({ ...base, tamanoBytes: 11 * 1024 * 1024 });
    expect(grande.status).toBe(400);

    const desc = await request(app).get(`/api/documentos/${ok.body.documento.id}/descarga`).set(auth('medico'));
    expect(desc.status).toBe(200);
    const prohibida = await request(app).get(`/api/documentos/${ok.body.documento.id}/descarga`).set(auth('admisiones'));
    expect(prohibida.status).toBe(403);
  });
});

describe('reportes y auditoría', () => {
  it('el reporte de ocupación es solo para admin', async () => {
    expect((await request(app).get('/api/reportes/ocupacion').set(auth('medico'))).status).toBe(403);
    const res = await request(app).get('/api/reportes/ocupacion').set(auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('citasPorEspecialidad');
  });

  it('el rol de la aplicación no puede modificar ni borrar la auditoría', async () => {
    await expect(db.query("UPDATE auditoria SET accion = 'x'")).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('DELETE FROM auditoria')).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('DELETE FROM pacientes')).rejects.toMatchObject({ code: '42501' });
  });
});
