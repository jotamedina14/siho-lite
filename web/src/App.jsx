import { useEffect, useState } from 'react';
import { alResponder } from './api.js';
import { cerrarSesion, completarCallback, iniciarSesion, obtenerConfig, sesionActual } from './auth.js';
import Admisiones from './vistas/Admisiones.jsx';
import Agenda from './vistas/Agenda.jsx';
import Auditoria from './vistas/Auditoria.jsx';
import Pacientes from './vistas/Pacientes.jsx';
import Reportes from './vistas/Reportes.jsx';

const VISTAS = [
  { id: 'pacientes', titulo: 'Pacientes', roles: ['admisiones', 'medico', 'admin'] },
  { id: 'agenda', titulo: 'Agenda', roles: ['admisiones', 'medico', 'admin'] },
  { id: 'admisiones', titulo: 'Admisiones', roles: ['admisiones', 'medico', 'admin'] },
  { id: 'reportes', titulo: 'Ocupación', roles: ['admin'] },
  { id: 'auditoria', titulo: 'Auditoría', roles: ['admin'] },
];

// Indicador de balanceo: muestra qué tarea de ECS y en qué zona respondió la última solicitud.
function IndicadorTarea() {
  const [info, setInfo] = useState(null);
  const [historial, setHistorial] = useState([]);
  useEffect(() => alResponder((i) => {
    setInfo(i);
    setHistorial((h) => [i.taskId, ...h].slice(0, 12));
  }), []);
  if (!info) return <span className="indicador indicador--vacio">Sin solicitudes aún</span>;
  const distintas = new Set(historial).size;
  return (
    <span className="indicador" title={`Últimas ${historial.length} solicitudes atendidas por ${distintas} tarea(s)`}>
      <span className="indicador__punto" />
      Tarea <b>{info.taskId.slice(0, 8)}</b> · {info.az} · {info.ms} ms
      <span className="indicador__extra">{distintas} tarea{distintas === 1 ? '' : 's'} en las últimas {historial.length}</span>
    </span>
  );
}

function Login({ error }) {
  const config = obtenerConfig();
  const [cargando, setCargando] = useState(false);
  const entrar = async (rol) => {
    setCargando(true);
    await iniciarSesion(rol);
    window.location.reload();
  };
  return (
    <div className="login">
      <div className="login__tarjeta">
        <div className="marca marca--grande"><span className="marca__cruz">+</span> SIHO Lite</div>
        <p className="login__sub">E.S.E. Hospital Regional del Fonce · Admisiones, agenda y documentos clínicos</p>
        {error && <p className="alerta alerta--error">{error}</p>}
        {config.authMode === 'cognito' ? (
          <button className="btn btn--primario btn--grande" disabled={cargando} onClick={() => { setCargando(true); iniciarSesion(); }}>
            Iniciar sesión con Amazon Cognito
          </button>
        ) : (
          <>
            <p className="nota">Modo desarrollo local: elige un rol de prueba.</p>
            <div className="fila">
              {['admisiones', 'medico', 'admin'].map((rol) => (
                <button key={rol} className="btn btn--primario" disabled={cargando} onClick={() => entrar(rol)}>{rol}</button>
              ))}
            </div>
          </>
        )}
        <p className="nota nota--legal">Prototipo académico con datos 100 % sintéticos (Ley 1581 de 2012).</p>
      </div>
    </div>
  );
}

export default function App() {
  const [sesion, setSesion] = useState(sesionActual);
  const [error, setError] = useState(null);
  const [procesando, setProcesando] = useState(window.location.pathname === '/callback');
  const disponibles = VISTAS.filter((v) => v.roles.some((r) => sesion?.grupos.includes(r)));
  const [vista, setVista] = useState(() => {
    const deUrl = new URLSearchParams(window.location.search).get('vista');
    return deUrl ?? 'pacientes';
  });

  useEffect(() => {
    if (window.location.pathname !== '/callback') return;
    completarCallback()
      .then(setSesion)
      .catch((e) => setError(e.message))
      .finally(() => setProcesando(false));
  }, []);

  if (procesando) return <div className="cargando">Completando inicio de sesión…</div>;
  if (!sesion) return <Login error={error} />;
  if (disponibles.length === 0) {
    return <Login error="Tu usuario no pertenece a ningún grupo (admin, admisiones o medico). Pide acceso al administrador." />;
  }
  const actual = disponibles.find((v) => v.id === vista) ?? disponibles[0];
  const config = obtenerConfig();

  return (
    <div className="app">
      <header className="barra">
        <div className="marca"><span className="marca__cruz">+</span> SIHO Lite</div>
        <nav className="nav">
          {disponibles.map((v) => (
            <button key={v.id} className={`nav__item ${v.id === actual.id ? 'nav__item--activo' : ''}`} onClick={() => setVista(v.id)}>
              {v.titulo}
            </button>
          ))}
        </nav>
        <IndicadorTarea />
        <div className="usuario">
          <span className="usuario__email">{sesion.email}</span>
          <span className="chip">{sesion.grupos.join(', ')}</span>
          <button className="btn btn--fantasma" onClick={cerrarSesion}>Salir</button>
        </div>
      </header>
      <main className="contenido">
        {actual.id === 'pacientes' && <Pacientes sesion={sesion} />}
        {actual.id === 'agenda' && <Agenda sesion={sesion} />}
        {actual.id === 'admisiones' && <Admisiones sesion={sesion} />}
        {actual.id === 'reportes' && <Reportes />}
        {actual.id === 'auditoria' && <Auditoria />}
      </main>
      <footer className="pie">
        SIHO Lite · prototipo académico · datos sintéticos · ambiente <b>{config.ambiente}</b>
      </footer>
    </div>
  );
}
