import { useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta } from './comunes.jsx';

const ETIQUETAS = { consulta_externa: 'Consulta externa', hospitalizacion: 'Hospitalización', urgencias: 'Urgencias' };

function Barras({ datos, etiqueta, valor, formato = (v) => v.toLocaleString('es-CO') }) {
  const max = Math.max(...datos.map((d) => d[valor]), 1);
  return (
    <div className="barras">
      {datos.map((d) => (
        <div className="barras__fila" key={d[etiqueta]}>
          <span className="barras__etiqueta">{ETIQUETAS[d[etiqueta]] ?? d[etiqueta]}</span>
          <span className="barras__pista"><span className="barras__valor" style={{ width: `${(100 * d[valor]) / max}%` }} /></span>
          <span className="barras__numero">{formato(d[valor])}</span>
        </div>
      ))}
    </div>
  );
}

function Columnas({ datos }) {
  const max = Math.max(...datos.map((d) => d.citas), 1);
  return (
    <div className="columnas" role="img" aria-label="Citas por día">
      {datos.map((d, i) => (
        <div className="columnas__col" key={d.dia} title={`${d.dia}: ${d.citas} citas, ${d.atendidas} atendidas`}>
          <div className="columnas__barra columnas__total" style={{ height: `${(100 * d.citas) / max}%` }}>
            <div className="columnas__barra columnas__atendidas" style={{ height: `${(100 * d.atendidas) / d.citas}%` }} />
          </div>
          <span className="columnas__dia">{i % 5 === 0 ? d.dia.slice(5) : ''}</span>
        </div>
      ))}
    </div>
  );
}

export default function Reportes() {
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api('/reportes/ocupacion').then(setR).catch((e) => setError(mensajeError(e))); }, []);
  if (error) return <Alerta error={error} />;
  if (!r) return <p className="tenue">Calculando reporte…</p>;
  const total = r.citasPorEstado.reduce((s, e) => s + e.citas, 0);
  return (
    <div className="pila">
      <div className="encabezado"><h1>Reporte de ocupación</h1><span className="tenue">{r.desde} a {r.hasta}</span></div>
      <div className="kpis">
        <div className="kpi"><span className="kpi__valor">{total.toLocaleString('es-CO')}</span><span>citas en el periodo</span></div>
        {r.citasPorEstado.map((e) => (
          <div className="kpi" key={e.estado}><span className="kpi__valor">{Math.round((100 * e.citas) / total)} %</span><span className="kpi__estado">{e.estado}</span></div>
        ))}
      </div>
      <section className="tarjeta">
        <h3>Citas por día <span className="leyenda"><i className="l-total" /> programadas <i className="l-atendidas" /> atendidas</span></h3>
        <Columnas datos={r.citasPorDia} />
      </section>
      <div className="dos-columnas">
        <section className="tarjeta"><h3>Citas por especialidad</h3><Barras datos={r.citasPorEspecialidad} etiqueta="especialidad" valor="citas" /></section>
        <section className="tarjeta"><h3>Admisiones por servicio</h3><Barras datos={r.admisionesPorServicio} etiqueta="servicio" valor="admisiones" />
          <h3>Estancia promedio (horas)</h3><Barras datos={r.admisionesPorServicio} etiqueta="servicio" valor="horasPromedio" formato={(v) => v.toFixed(1)} />
        </section>
      </div>
    </div>
  );
}
