import { useEffect, useState } from 'react';
import { api, mensajeError, subirDocumento } from '../api.js';
import { Alerta, Estado, fechaHora, tiene } from './comunes.jsx';

const SERVICIOS = { urgencias: 'Urgencias', consulta_externa: 'Consulta externa', hospitalizacion: 'Hospitalización' };
const VACIO = { tipoDocumento: 'CC', numeroDocumento: '', nombres: '', apellidos: '', fechaNacimiento: '', sexo: 'F', telefono: '', email: '', eps: '', municipio: '' };

function NuevoPaciente({ onCreado, onCancelar }) {
  const [f, setF] = useState(VACIO);
  const [error, setError] = useState(null);
  const campo = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  const guardar = async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
    try { onCreado(await api('/pacientes', { method: 'POST', body: datos })); } catch (err) { setError(mensajeError(err)); }
  };
  return (
    <form className="tarjeta formulario" onSubmit={guardar}>
      <h2>Nuevo paciente</h2>
      <div className="rejilla">
        <label>Tipo de documento<select {...campo('tipoDocumento')}>{['CC', 'TI', 'RC', 'CE', 'PA'].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Número<input required {...campo('numeroDocumento')} /></label>
        <label>Nombres<input required {...campo('nombres')} /></label>
        <label>Apellidos<input required {...campo('apellidos')} /></label>
        <label>Fecha de nacimiento<input required type="date" {...campo('fechaNacimiento')} /></label>
        <label>Sexo<select {...campo('sexo')}><option value="F">Femenino</option><option value="M">Masculino</option><option value="I">Indeterminado</option></select></label>
        <label>Teléfono<input {...campo('telefono')} /></label>
        <label>Correo<input type="email" {...campo('email')} /></label>
        <label>EPS<input {...campo('eps')} /></label>
        <label>Municipio<input {...campo('municipio')} /></label>
      </div>
      <Alerta error={error} />
      <div className="fila">
        <button className="btn btn--primario">Guardar</button>
        <button type="button" className="btn btn--fantasma" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function Documentos({ paciente, sesion, onCambio }) {
  const [archivo, setArchivo] = useState(null);
  const [tipo, setTipo] = useState('orden');
  const [msg, setMsg] = useState({});
  const puedeSubir = tiene(sesion, 'admisiones', 'medico');
  const puedeDescargar = tiene(sesion, 'medico', 'admin');

  const subir = async (e) => {
    e.preventDefault();
    try {
      setMsg({});
      await subirDocumento(paciente.id, archivo, tipo);
      setMsg({ ok: `«${archivo.name}» subido y cifrado en S3.` });
      setArchivo(null);
      e.target.reset();
      onCambio();
    } catch (err) { setMsg({ error: mensajeError(err) }); }
  };
  const descargar = async (doc) => {
    try { window.open((await api(`/documentos/${doc.id}/descarga`)).url, '_blank', 'noopener'); } catch (err) { setMsg({ error: mensajeError(err) }); }
  };

  return (
    <section className="tarjeta">
      <h3>Documentos clínicos</h3>
      {paciente.documentos.length === 0 ? <p className="tenue">Sin documentos.</p> : (
        <table>
          <thead><tr><th>Tipo</th><th>Archivo</th><th>Tamaño</th><th>Subido</th><th /></tr></thead>
          <tbody>
            {paciente.documentos.map((d) => (
              <tr key={d.id}>
                <td>{d.tipo.replace('_', ' ')}</td><td>{d.nombreOriginal}</td><td>{d.tamanoBytes < 1024 ? `${d.tamanoBytes} B` : d.tamanoBytes < 1048576 ? `${(d.tamanoBytes / 1024).toFixed(0)} KB` : `${(d.tamanoBytes / 1048576).toFixed(1)} MB`}</td>
                <td>{fechaHora(d.subidoEn)}</td>
                <td>{puedeDescargar && <button className="btn btn--fantasma" onClick={() => descargar(d)}>Descargar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {puedeSubir && (
        <form className="fila" onSubmit={subir}>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {['orden', 'resultado_laboratorio', 'epicrisis', 'consentimiento', 'otro'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <input type="file" accept="application/pdf,image/jpeg,image/png" required onChange={(e) => setArchivo(e.target.files[0])} />
          <button className="btn btn--primario" disabled={!archivo}>Subir</button>
        </form>
      )}
      <p className="nota">PDF, JPG o PNG hasta 10 MB. Se sube directo a S3 con URL prefirmada de 5 minutos.</p>
      <Alerta {...msg} />
    </section>
  );
}

function Ficha({ id, sesion, onVolver }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const cargar = () => api(`/pacientes/${id}`).then(setP).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, [id]);
  if (error) return <Alerta error={error} />;
  if (!p) return <p className="tenue">Cargando ficha…</p>;
  const edad = Math.floor((Date.now() - new Date(p.fechaNacimiento)) / (365.25 * 86_400_000));
  return (
    <div className="pila">
      <button className="btn btn--fantasma" onClick={onVolver}>← Volver a la búsqueda</button>
      <section className="tarjeta ficha">
        <div>
          <h2>{p.nombres} {p.apellidos}</h2>
          <p className="tenue">{p.tipoDocumento} {p.numeroDocumento} · {edad} años · {p.sexo === 'F' ? 'Femenino' : p.sexo === 'M' ? 'Masculino' : 'Indeterminado'}</p>
        </div>
        <dl className="datos">
          <dt>EPS</dt><dd>{p.eps ?? '—'}</dd>
          <dt>Municipio</dt><dd>{p.municipio ?? '—'}</dd>
          <dt>Teléfono</dt><dd>{p.telefono ?? '—'}</dd>
          <dt>Correo</dt><dd>{p.email ?? '—'}</dd>
        </dl>
        <p className="nota">Esta consulta quedó registrada en la auditoría.</p>
      </section>
      <div className="dos-columnas">
        <section className="tarjeta">
          <h3>Citas recientes</h3>
          {p.citas.length === 0 ? <p className="tenue">Sin citas.</p> : (
            <table><tbody>{p.citas.map((c) => (
              <tr key={c.id}><td>{fechaHora(c.fechaHora)}</td><td>{c.especialidad}</td><td><Estado valor={c.estado} /></td></tr>
            ))}</tbody></table>
          )}
        </section>
        <section className="tarjeta">
          <h3>Admisiones</h3>
          {p.admisiones.length === 0 ? <p className="tenue">Sin admisiones.</p> : (
            <table><tbody>{p.admisiones.map((a) => (
              <tr key={a.id}><td>{fechaHora(a.fechaIngreso)}</td><td>{SERVICIOS[a.servicio]}</td><td>{a.motivo}</td><td><Estado valor={a.estado} /></td></tr>
            ))}</tbody></table>
          )}
        </section>
      </div>
      <Documentos paciente={p} sesion={sesion} onCambio={cargar} />
    </div>
  );
}

export default function Pacientes({ sesion }) {
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [seleccion, setSeleccion] = useState(null);
  const [creando, setCreando] = useState(false);

  const buscar = async (pag = 1) => {
    try {
      setError(null);
      setRes(await api('/pacientes', { query: { q, page: pag } }));
      setPagina(pag);
    } catch (err) { setError(mensajeError(err)); }
  };
  useEffect(() => { buscar(1); }, []);

  if (seleccion) return <Ficha id={seleccion} sesion={sesion} onVolver={() => setSeleccion(null)} />;
  if (creando) return <NuevoPaciente onCancelar={() => setCreando(false)} onCreado={(p) => { setCreando(false); setSeleccion(p.id); }} />;

  const paginas = res ? Math.ceil(res.total / res.tamanoPagina) : 0;
  return (
    <div className="pila">
      <div className="encabezado">
        <h1>Pacientes</h1>
        {tiene(sesion, 'admisiones', 'admin') && <button className="btn btn--primario" onClick={() => setCreando(true)}>+ Nuevo paciente</button>}
      </div>
      <form className="fila" onSubmit={(e) => { e.preventDefault(); buscar(1); }}>
        <input className="buscador" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número de documento, apellido o nombre" />
        <button className="btn btn--primario">Buscar</button>
      </form>
      <Alerta error={error} />
      {res && (
        <section className="tarjeta">
          <p className="tenue">{res.total.toLocaleString('es-CO')} pacientes</p>
          <table className="tabla-clic">
            <thead><tr><th>Documento</th><th>Apellidos</th><th>Nombres</th><th>Nacimiento</th><th>EPS</th><th>Municipio</th></tr></thead>
            <tbody>
              {res.datos.map((p) => (
                <tr key={p.id} onClick={() => setSeleccion(p.id)}>
                  <td>{p.tipoDocumento} {p.numeroDocumento}</td><td>{p.apellidos}</td><td>{p.nombres}</td>
                  <td>{p.fechaNacimiento}</td><td>{p.eps}</td><td>{p.municipio}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {paginas > 1 && (
            <div className="fila paginacion">
              <button className="btn btn--fantasma" disabled={pagina <= 1} onClick={() => buscar(pagina - 1)}>← Anterior</button>
              <span>Página {pagina} de {paginas}</span>
              <button className="btn btn--fantasma" disabled={pagina >= paginas} onClick={() => buscar(pagina + 1)}>Siguiente →</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
