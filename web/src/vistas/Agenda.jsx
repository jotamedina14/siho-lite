import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, BuscarPaciente, Estado, hora, hoyBogota, tiene } from './comunes.jsx';

function NuevaCita({ profesionales, fecha, onCreada }) {
  const [paciente, setPaciente] = useState(null);
  const [profesionalId, setProfesionalId] = useState('');
  const [dia, setDia] = useState(fecha);
  const [h, setH] = useState('08:00');
  const [msg, setMsg] = useState({});
  const agendar = async (e) => {
    e.preventDefault();
    try {
      await api('/citas', { method: 'POST', body: { pacienteId: paciente.id, profesionalId, fechaHora: `${dia}T${h}:00-05:00` } });
      setMsg({ ok: 'Cita agendada.' });
      setPaciente(null);
      onCreada(dia);
    } catch (err) { setMsg({ error: mensajeError(err) }); }
  };
  return (
    <form className="tarjeta formulario" onSubmit={agendar}>
      <h3>Agendar cita</h3>
      <BuscarPaciente elegido={paciente} onElegir={setPaciente} />
      <div className="rejilla">
        <label>Profesional
          <select required value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)}>
            <option value="">Selecciona…</option>
            {profesionales.map((p) => <option key={p.id} value={p.id}>{p.especialidad} · {p.nombres}</option>)}
          </select>
        </label>
        <label>Fecha<input type="date" required value={dia} onChange={(e) => setDia(e.target.value)} /></label>
        <label>Hora<input type="time" required step="1200" value={h} onChange={(e) => setH(e.target.value)} /></label>
      </div>
      <Alerta {...msg} />
      <button className="btn btn--primario" disabled={!paciente || !profesionalId}>Agendar</button>
    </form>
  );
}

export default function Agenda({ sesion }) {
  const [fecha, setFecha] = useState(hoyBogota());
  const [profesional, setProfesional] = useState('');
  const [profesionales, setProfesionales] = useState([]);
  const [citas, setCitas] = useState([]);
  const [error, setError] = useState(null);

  const cargar = (f = fecha) => api('/citas', { query: { fecha: f, profesional } })
    .then((r) => { setCitas(r.datos); setError(null); })
    .catch((e) => setError(mensajeError(e)));
  useEffect(() => { api('/profesionales').then((r) => setProfesionales(r.datos)).catch(() => {}); }, []);
  useEffect(() => { cargar(); }, [fecha, profesional]);

  const cambiarEstado = async (cita, estado) => {
    try { await api(`/citas/${cita.id}`, { method: 'PATCH', body: { estado } }); cargar(); } catch (err) { setError(mensajeError(err)); }
  };
  const puedeCambiar = tiene(sesion, 'admisiones', 'medico');
  const resumen = citas.reduce((acc, c) => ({ ...acc, [c.estado]: (acc[c.estado] ?? 0) + 1 }), {});

  return (
    <div className="pila">
      <div className="encabezado"><h1>Agenda del día</h1></div>
      <div className="fila">
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <select value={profesional} onChange={(e) => setProfesional(e.target.value)}>
          <option value="">Todos los profesionales</option>
          {profesionales.map((p) => <option key={p.id} value={p.id}>{p.especialidad} · {p.nombres}</option>)}
        </select>
        <span className="tenue">{citas.length} citas · {Object.entries(resumen).map(([k, v]) => `${v} ${k}`).join(' · ')}</span>
      </div>
      <Alerta error={error} />
      <div className="dos-columnas dos-columnas--ancha">
        <section className="tarjeta">
          {citas.length === 0 ? <p className="tenue">No hay citas para este día.</p> : (
            <table>
              <thead><tr><th>Hora</th><th>Paciente</th><th>Profesional</th><th>Especialidad</th><th>Estado</th>{puedeCambiar && <th />}</tr></thead>
              <tbody>
                {citas.map((c) => (
                  <tr key={c.id}>
                    <td>{hora(c.fechaHora)}</td><td>{c.paciente}</td><td>{c.profesional}</td><td>{c.especialidad}</td>
                    <td><Estado valor={c.estado} /></td>
                    {puedeCambiar && (
                      <td className="acciones">
                        {c.estado === 'programada' && <>
                          <button className="btn btn--mini" onClick={() => cambiarEstado(c, 'atendida')}>Atendida</button>
                          <button className="btn btn--mini btn--fantasma" onClick={() => cambiarEstado(c, 'inasistencia')}>No asistió</button>
                        </>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {tiene(sesion, 'admisiones', 'admin') && (
          <NuevaCita profesionales={profesionales} fecha={fecha} onCreada={(d) => (d === fecha ? cargar() : setFecha(d))} />
        )}
      </div>
    </div>
  );
}
