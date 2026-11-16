// Genera datos 100 % sintéticos con Faker (Ley 1581 de 2012: nunca datos reales de pacientes).
// Faker JS no trae el locale es_CO, así que se usa el locale "es" y listas colombianas propias
// (municipios del área de influencia del Hospital Regional del Fonce, EPS, tipos de documento).
// Uso: node src/db/seed.js [--forzar]
import { fileURLToPath } from 'node:url';
import { fakerES as faker } from '@faker-js/faker';
import { loadConfig } from '../config/index.js';
import { logger } from '../logger.js';
import { createPool } from './pool.js';

const CANTIDAD = { pacientes: 5000, profesionales: 30, citas: 20000, admisiones: 3000 };

const MUNICIPIOS = [
  'San Gil', 'Socorro', 'Barichara', 'Curití', 'Pinchote', 'Villanueva', 'Mogotes', 'Valle de San José',
  'Charalá', 'Páramo', 'Oiba', 'Aratoca', 'Cabrera', 'Onzaga', 'Simacota', 'Confines', 'Palmas del Socorro',
  'Barbosa', 'Bucaramanga', 'Vélez',
];
const EPS = ['Nueva EPS', 'Sanitas', 'Sura', 'Coosalud', 'Salud Total', 'Famisanar', 'Compensar', 'Asmet Salud', 'Cajacopi'];
const ESPECIALIDADES = [
  'Medicina general', 'Medicina general', 'Medicina general', 'Pediatría', 'Ginecología', 'Medicina interna',
  'Ortopedia', 'Cirugía general', 'Psicología', 'Nutrición', 'Odontología', 'Fisioterapia',
];
const MOTIVOS = {
  urgencias: ['Dolor abdominal', 'Trauma en miembro inferior', 'Fiebre persistente', 'Dificultad respiratoria', 'Dolor torácico', 'Cefalea intensa', 'Herida por objeto cortante'],
  consulta_externa: ['Control de hipertensión', 'Control prenatal', 'Control de crecimiento y desarrollo', 'Valoración por especialista', 'Control de diabetes'],
  hospitalizacion: ['Neumonía', 'Postoperatorio', 'Infección de vías urinarias complicada', 'Descompensación de diabetes', 'Observación por trauma'],
};

const DIA_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

// Fecha y hora en Colombia (UTC-5, sin horario de verano) como ISO con desfase explícito.
function fechaBogota(base, dias, hora, minuto) {
  const d = new Date(base.getTime() + dias * DIA_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(hora)}:${pad(minuto)}:00-05:00`;
}

async function insertarPorLotes(client, tabla, columnas, filas, tamanoLote = 1000) {
  for (let i = 0; i < filas.length; i += tamanoLote) {
    const lote = filas.slice(i, i + tamanoLote);
    const valores = [];
    const marcadores = lote.map((fila, f) => {
      valores.push(...fila);
      return `(${fila.map((_, c) => `$${f * fila.length + c + 1}`).join(', ')})`;
    });
    await client.query(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ${marcadores.join(', ')}`, valores);
  }
}

function generarPacientes() {
  const usados = new Set();
  const filas = [];
  while (filas.length < CANTIDAD.pacientes) {
    const nacimiento = faker.date.birthdate({ mode: 'age', min: 0, max: 95 });
    const edad = (Date.now() - nacimiento.getTime()) / (365.25 * DIA_MS);
    const tipo = edad < 7 ? 'RC' : edad < 18 ? 'TI' : faker.helpers.weightedArrayElement([
      { weight: 94, value: 'CC' }, { weight: 4, value: 'CE' }, { weight: 2, value: 'PA' },
    ]);
    const numero = String(faker.number.int({ min: 10_000_000, max: 1_199_999_999 }));
    if (usados.has(tipo + numero)) continue;
    usados.add(tipo + numero);
    const sexo = faker.helpers.arrayElement(['F', 'M']);
    const nombres = faker.person.firstName(sexo === 'F' ? 'female' : 'male');
    const apellido = () => faker.person.lastName().split(" ")[0];
    const apellidos = `${apellido()} ${apellido()}`;
    filas.push([
      faker.string.uuid(), tipo, numero, nombres, apellidos, nacimiento.toISOString().slice(0, 10), sexo,
      `3${faker.string.numeric(9)}`,
      faker.internet.email({ firstName: nombres, lastName: apellidos.split(' ')[0], provider: 'correo.example' }).toLowerCase(),
      faker.helpers.arrayElement(EPS), faker.helpers.arrayElement(MUNICIPIOS),
    ]);
  }
  return filas;
}

function generarProfesionales() {
  return Array.from({ length: CANTIDAD.profesionales }, (_, i) => [
    faker.string.uuid(),
    `${faker.person.firstName()} ${faker.person.lastName()}`,
    ESPECIALIDADES[i % ESPECIALIDADES.length],
    `RM-${faker.string.numeric(6)}`,
    true,
  ]);
}

// Citas desde hace 60 días hasta dentro de 30, en franjas de 20 minutos de 7:00 a 17:00,
// sin cruces para el mismo profesional.
function generarCitas(pacientes, profesionales, hoy) {
  const ocupadas = new Set();
  const filas = [];
  while (filas.length < CANTIDAD.citas) {
    const prof = faker.helpers.arrayElement(profesionales);
    const dias = faker.number.int({ min: -60, max: 30 });
    const franja = faker.number.int({ min: 0, max: 29 });
    const clave = `${prof[0]}|${dias}|${franja}`;
    if (ocupadas.has(clave)) continue;
    ocupadas.add(clave);
    const hora = 7 + Math.floor((franja * 20) / 60);
    const minuto = (franja * 20) % 60;
    const estado = dias < 0
      ? faker.helpers.weightedArrayElement([
        { weight: 75, value: 'atendida' }, { weight: 15, value: 'inasistencia' }, { weight: 10, value: 'cancelada' },
      ])
      : faker.helpers.weightedArrayElement([{ weight: 90, value: 'programada' }, { weight: 10, value: 'cancelada' }]);
    filas.push([
      faker.string.uuid(), faker.helpers.arrayElement(pacientes)[0], prof[0],
      fechaBogota(hoy, dias, hora, minuto), prof[2], estado, null,
    ]);
  }
  return filas;
}

function generarAdmisiones(pacientes, hoy) {
  return Array.from({ length: CANTIDAD.admisiones }, () => {
    const servicio = faker.helpers.weightedArrayElement([
      { weight: 40, value: 'urgencias' }, { weight: 45, value: 'consulta_externa' }, { weight: 15, value: 'hospitalizacion' },
    ]);
    const dias = faker.number.int({ min: -60, max: 0 });
    const ingreso = new Date(new Date(fechaBogota(hoy, dias, faker.number.int({ min: 0, max: 23 }), faker.number.int({ min: 0, max: 59 }))));
    const horasEstancia = servicio === 'hospitalizacion' ? faker.number.int({ min: 24, max: 240 }) : faker.number.int({ min: 1, max: 12 });
    const egreso = new Date(ingreso.getTime() + horasEstancia * 3_600_000);
    const cerrada = egreso.getTime() < Date.now() && faker.number.int({ min: 1, max: 100 }) > 3;
    return [
      faker.string.uuid(), faker.helpers.arrayElement(pacientes)[0], servicio,
      faker.helpers.arrayElement(MOTIVOS[servicio]),
      servicio === 'urgencias' ? faker.helpers.weightedArrayElement([
        { weight: 3, value: 1 }, { weight: 12, value: 2 }, { weight: 40, value: 3 }, { weight: 35, value: 4 }, { weight: 10, value: 5 },
      ]) : null,
      cerrada ? 'cerrada' : 'abierta', ingreso.toISOString(), cerrada ? egreso.toISOString() : null,
    ];
  });
}

export async function seed({ dbConfig, credenciales, forzar = false }) {
  faker.seed(20261116); // reproducible
  const pool = createPool(dbConfig, { ...credenciales, max: 1 });
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT count(*) AS n FROM pacientes');
    if (rows[0].n > 0 && !forzar) {
      logger.info({ pacientes: rows[0].n }, 'la base ya tiene datos; seed omitido (use --forzar para recrear)');
      return;
    }
    const hoy = new Date();
    const pacientes = generarPacientes();
    const profesionales = generarProfesionales();
    const citas = generarCitas(pacientes, profesionales, hoy);
    const admisiones = generarAdmisiones(pacientes, hoy);

    await client.query('BEGIN');
    if (forzar) await client.query('TRUNCATE documentos, admisiones, citas, profesionales, pacientes');
    await insertarPorLotes(client, 'pacientes',
      ['id', 'tipo_documento', 'numero_documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'sexo', 'telefono', 'email', 'eps', 'municipio'], pacientes);
    await insertarPorLotes(client, 'profesionales', ['id', 'nombres', 'especialidad', 'registro_medico', 'activo'], profesionales);
    await insertarPorLotes(client, 'citas', ['id', 'paciente_id', 'profesional_id', 'fecha_hora', 'especialidad', 'estado', 'observaciones'], citas);
    await insertarPorLotes(client, 'admisiones', ['id', 'paciente_id', 'servicio', 'motivo', 'triage', 'estado', 'fecha_ingreso', 'fecha_egreso'], admisiones);
    await client.query('COMMIT');
    await client.query('ANALYZE');
    logger.info({
      pacientes: pacientes.length, profesionales: profesionales.length, citas: citas.length, admisiones: admisiones.length,
    }, 'seed completo');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig({ validarAuth: false });
  seed({ dbConfig: config.db, credenciales: config.dbAdmin, forzar: process.argv.includes('--forzar') })
    .catch((err) => {
      logger.error({ err }, 'fallo en seed');
      process.exit(1);
    });
}
