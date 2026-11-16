// Identifica la tarea de ECS y su zona de disponibilidad con el endpoint de metadatos v4.
// Sirve para demostrar el balanceo en vivo (cabeceras X-Task-Id / X-AZ y /api/info).
import os from 'node:os';

export async function obtenerInfoTarea() {
  const uri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!uri) return { taskId: os.hostname(), az: 'local', origen: 'local' };
  try {
    const res = await fetch(`${uri}/task`, { signal: AbortSignal.timeout(2000) });
    const datos = await res.json();
    return {
      taskId: datos.TaskARN.split('/').pop(),
      az: datos.AvailabilityZone,
      origen: 'ecs',
      cluster: datos.Cluster?.split('/').pop(),
      revision: `${datos.Family}:${datos.Revision}`,
    };
  } catch {
    return { taskId: os.hostname(), az: 'desconocida', origen: 'ecs-sin-metadatos' };
  }
}
