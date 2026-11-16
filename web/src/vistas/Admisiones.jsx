import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, BuscarPaciente, fechaHora, tiene } from './comunes.jsx';

const SERVICIOS = { urgencias: 'Urgencias', consulta_externa: 'Consulta externa', hospitalizacion: 'Hospitalización' };
const TRIAGE = { 1: 'I · Resucitación', 2: 'II · Emergencia', 3: 'III · Urgencia', 4: 'IV · Menor', 5: 'V · No urgente' };

function NuevaAdmision({ onCreada }) {
  const [paciente, setPaciente] = useState(null);
  const [servicio, setServicio] = useState('urgencias');
  const [motivo, setMotivo] = useState('');
  const [triage, setTriage] = useState('3');
  const [msg, setMsg] = useState({});
  const abrir = async (e) => {
    e.preventDefault();
    try {
      await api('/admisiones', {
        method: 'POST',
        body: { pacienteId: paciente.id, servicio, motivo, ...(servicio === 'urgencias' ? { triage: Number(triage) } : {}) },
      });
      setMsg({ ok: 'Admisión abierta.' });
      setPaciente(null); setMotivo('');
      onCreada();
    } catch (err) { setMsg({ error: mensajeError(err) }); }
  };
  return (
    <form className="tarjeta formulario" onSubmit={abrir}>
      <h3>Nueva admisión</h3>
      <BuscarPaciente elegido={paciente} onElegir={setPaciente} />
      <div className="rejilla">
        <label>Servicio
          <select value={servicio} onChange={(e) => setServicio(e.target.value)}>
            <option value="urgencias">Urgencias</option>
            <option value="consulta_externa">Consulta externa</option>
            <option value="hospitalizacion">Hospitalización</option>
          </select>
        </label>
        {servicio === 'urgencias' && (
          <label>Triage
            <select value={triage} onChange={(e) => setTriage(e.target.value)}>
              {Object.entries(TRIAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
      </div>
      <label>Motivo de ingreso<textarea required minLength={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
      <Alerta {...msg} />
      <button className="btn btn--primario" disabled={!paciente}>Abrir admisión</button>
    </form>
  );
}

export default function Admisiones({ sesion }) {
  const [estado, setEstado] = useState('abierta');
  const [datos, setDatos] = useState([]);
  const [error, setError] = useState(null);
  const cargar = () => api('/admisiones', { query: { estado } }).then((r) => { setDatos(r.datos); setError(null); }).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, [estado]);
  const cerrar = async (a) => {
    try { await api(`/admisiones/${a.id}/cerrar`, { method: 'PATCH' }); cargar(); } catch (err) { setError(mensajeError(err)); }
  };
  const puedeCerrar = tiene(sesion, 'admisiones', 'medico');

  return (
    <div className="pila">
      <div className="encabezado"><h1>Admisiones</h1></div>
      <div className="fila">
        <button className={`btn ${estado === 'abierta' ? 'btn--primario' : 'btn--fantasma'}`} onClick={() => setEstado('abierta')}>Abiertas</button>
        <button className={`btn ${estado === 'cerrada' ? 'btn--primario' : 'btn--fantasma'}`} onClick={() => setEstado('cerrada')}>Cerradas recientes</button>
      </div>
      <Alerta error={error} />
      <div className="dos-columnas dos-columnas--ancha">
        <section className="tarjeta">
          <table>
            <thead><tr><th>Ingreso</th><th>Paciente</th><th>Servicio</th><th>Triage</th><th>Motivo</th>{puedeCerrar && estado === 'abierta' && <th />}</tr></thead>
            <tbody>
              {datos.map((a) => (
                <tr key={a.id}>
                  <td>{fechaHora(a.fechaIngreso)}</td><td>{a.paciente}</td><td>{SERVICIOS[a.servicio]}</td>
                  <td>{a.triage ? <span className={`triage triage--${a.triage}`}>{a.triage}</span> : '—'}</td><td>{a.motivo}</td>
                  {puedeCerrar && estado === 'abierta' && <td><button className="btn btn--mini" onClick={() => cerrar(a)}>Dar egreso</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {tiene(sesion, 'admisiones') && <NuevaAdmision onCreada={cargar} />}
      </div>
    </div>
  );
}
