// Registro de auditoría en la tabla de solo inserción.
export async function auditar(db, req, accion, recurso, recursoId = null) {
  await db.query(
    `INSERT INTO auditoria (usuario_sub, usuario_email, rol, accion, recurso, recurso_id, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      req.user?.sub ?? null,
      req.user?.email ?? null,
      (req.user?.grupos ?? []).join(','),
      accion,
      recurso,
      recursoId,
      req.ip ?? null,
      (req.get('user-agent') ?? '').slice(0, 300),
    ],
  );
}
