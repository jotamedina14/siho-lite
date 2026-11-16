import { useState } from 'react';
import { api, mensajeError } from '../api.js';

export const fechaHora = (iso) => new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
export const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });
export const hoyBogota = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

export const tiene = (sesion, ...roles) => sesion.grupos.some((g) => roles.includes(g));

export function Alerta({ error, ok }) {
  if (error) return <p className="alerta alerta--error">{error}</p>;
  if (ok) return <p className="alerta alerta--ok">{ok}</p>;
  return null;
}

export function Estado({ valor }) {
  return <span className={`estado estado--${valor}`}>{valor.replace('_', ' ')}</span>;
}

// Buscador de pacientes por documento o apellido, reutilizado en agenda y admisiones.
export function BuscarPaciente({ onElegir, elegido }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState([]);
  const [error, setError] = useState(null);
  const buscar = async (e) => {
    e.preventDefault();
    try {
      setError(null);
      setResultados((await api('/pacientes', { query: { q } })).datos.slice(0, 6));
    } catch (err) { setError(mensajeError(err)); }
  };
  if (elegido) {
    return (
      <div className="elegido">
        <span><b>{elegido.nombres} {elegido.apellidos}</b> · {elegido.tipoDocumento} {elegido.numeroDocumento}</span>
        <button type="button" className="btn btn--fantasma" onClick={() => onElegir(null)}>Cambiar</button>
      </div>
    );
  }
  return (
    <div>
      <div className="fila">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && buscar(e)} placeholder="Documento o apellido del paciente" />
        <button type="button" className="btn" onClick={buscar}>Buscar</button>
      </div>
      <Alerta error={error} />
      {resultados.length > 0 && (
        <ul className="lista-seleccion">
          {resultados.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onElegir(p); setResultados([]); }}>
                {p.apellidos}, {p.nombres} <span className="tenue">{p.tipoDocumento} {p.numeroDocumento}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
