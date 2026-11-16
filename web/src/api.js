import { cerrarSesion, sesionActual } from './auth.js';

// Cada respuesta trae X-Task-Id y X-AZ: se publican para el indicador de balanceo de la barra superior.
const oyentes = new Set();
export const alResponder = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn); };

export class ApiError extends Error {
  constructor(status, cuerpo) {
    super(cuerpo?.error ?? `HTTP ${status}`);
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

export async function api(ruta, { method = 'GET', body, query } = {}) {
  const sesion = sesionActual();
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''))}` : '';
  const inicio = performance.now();
  const res = await fetch(`/api${ruta}${qs}`, {
    method,
    headers: {
      ...(sesion ? { authorization: `Bearer ${sesion.idToken}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const info = { taskId: res.headers.get('x-task-id'), az: res.headers.get('x-az'), ms: Math.round(performance.now() - inicio), ruta };
  if (info.taskId) oyentes.forEach((fn) => fn(info));
  if (res.status === 401) {
    cerrarSesion();
    throw new ApiError(401, { error: 'sesion_expirada' });
  }
  const datos = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, datos);
  return datos;
}

const MENSAJES = {
  prohibido: 'Tu rol no tiene permiso para esta acción.',
  cruce_de_horario: 'El profesional o el paciente ya tiene una cita en ese horario.',
  registro_duplicado: 'Ya existe un registro con esos datos (¿documento repetido?).',
  paciente_con_admision_abierta: 'El paciente ya tiene una admisión abierta.',
  datos_invalidos: 'Revisa los datos del formulario.',
  admision_ya_cerrada: 'La admisión ya estaba cerrada.',
};

export function mensajeError(err) {
  if (err instanceof ApiError) {
    const base = MENSAJES[err.cuerpo?.error] ?? `Error ${err.status}: ${err.cuerpo?.error ?? 'desconocido'}`;
    const detalle = err.cuerpo?.detalle?.map?.((d) => `${d.campo}: ${d.mensaje}`).join('; ');
    return detalle ? `${base} (${detalle})` : base;
  }
  return err.message ?? String(err);
}

// Sube un archivo directo a S3 con la URL prefirmada; S3 valida tipo y SHA-256.
export async function subirDocumento(pacienteId, archivo, tipo) {
  const sha = await crypto.subtle.digest('SHA-256', await archivo.arrayBuffer());
  const sha256 = [...new Uint8Array(sha)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { documento, subida } = await api(`/pacientes/${pacienteId}/documentos`, {
    method: 'POST',
    body: { tipo, nombre: archivo.name, contentType: archivo.type, tamanoBytes: archivo.size, sha256 },
  });
  const res = await fetch(subida.url, { method: subida.metodo, headers: subida.cabeceras, body: archivo });
  if (!res.ok) throw new Error(`S3 rechazó el archivo (HTTP ${res.status})`);
  return documento;
}
