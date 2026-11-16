import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, fechaHora } from './comunes.jsx';

export default function Auditoria() {
  const [datos, setDatos] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [recurso, setRecurso] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    api('/auditoria', { query: { page: pagina, recurso } }).then((r) => setDatos(r.datos)).catch((e) => setError(mensajeError(e)));
  }, [pagina, recurso]);
  return (
    <div className="pila">
      <div className="encabezado"><h1>Auditoría</h1><span className="tenue">Registro de solo inserción: la aplicación no puede modificarlo ni borrarlo.</span></div>
      <div className="fila">
        <select value={recurso} onChange={(e) => { setRecurso(e.target.value); setPagina(1); }}>
          <option value="">Todos los recursos</option>
          {['paciente', 'cita', 'admision', 'documento'].map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>
      <Alerta error={error} />
      <section className="tarjeta">
        <table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Recurso</th><th>Id</th><th>IP</th></tr></thead>
          <tbody>
            {datos.map((a) => (
              <tr key={a.id}>
                <td>{fechaHora(a.ocurridoEn)}</td><td>{a.usuarioEmail}</td><td>{a.rol}</td><td><b>{a.accion}</b></td>
                <td>{a.recurso}</td><td className="mono">{a.recursoId?.slice(0, 8)}</td><td className="mono">{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="fila paginacion">
          <button className="btn btn--fantasma" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
          <span>Página {pagina}</span>
          <button className="btn btn--fantasma" disabled={datos.length < 50} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
        </div>
      </section>
    </div>
  );
}
