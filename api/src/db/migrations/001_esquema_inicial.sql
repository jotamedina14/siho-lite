-- Esquema inicial de SIHO Lite. Solo datos sintéticos.

CREATE TABLE pacientes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento   varchar(2)   NOT NULL CHECK (tipo_documento IN ('CC', 'TI', 'RC', 'CE', 'PA')),
  numero_documento varchar(20)  NOT NULL,
  nombres          varchar(100) NOT NULL,
  apellidos        varchar(100) NOT NULL,
  fecha_nacimiento date         NOT NULL,
  sexo             char(1)      NOT NULL CHECK (sexo IN ('F', 'M', 'I')),
  telefono         varchar(20),
  email            varchar(150),
  eps              varchar(80),
  municipio        varchar(80),
  creado_en        timestamptz  NOT NULL DEFAULT now(),
  actualizado_en   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pacientes_documento_unico UNIQUE (tipo_documento, numero_documento)
);
CREATE INDEX pacientes_numero_documento_idx ON pacientes (numero_documento varchar_pattern_ops);
CREATE INDEX pacientes_apellidos_idx ON pacientes (lower(apellidos) varchar_pattern_ops);

CREATE TABLE profesionales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombres         varchar(150) NOT NULL,
  especialidad    varchar(80)  NOT NULL,
  registro_medico varchar(30)  NOT NULL UNIQUE,
  activo          boolean      NOT NULL DEFAULT true
);

CREATE TABLE citas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id    uuid        NOT NULL REFERENCES pacientes (id),
  profesional_id uuid        NOT NULL REFERENCES profesionales (id),
  fecha_hora     timestamptz NOT NULL,
  especialidad   varchar(80) NOT NULL,
  estado         varchar(15) NOT NULL DEFAULT 'programada'
                 CHECK (estado IN ('programada', 'atendida', 'cancelada', 'inasistencia')),
  observaciones  text,
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX citas_fecha_hora_idx ON citas (fecha_hora);
CREATE INDEX citas_profesional_fecha_idx ON citas (profesional_id, fecha_hora);
CREATE INDEX citas_paciente_idx ON citas (paciente_id);

CREATE TABLE admisiones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id   uuid        NOT NULL REFERENCES pacientes (id),
  servicio      varchar(20) NOT NULL CHECK (servicio IN ('urgencias', 'consulta_externa', 'hospitalizacion')),
  motivo        text        NOT NULL,
  triage        smallint    CHECK (triage BETWEEN 1 AND 5),
  estado        varchar(10) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  fecha_ingreso timestamptz NOT NULL DEFAULT now(),
  fecha_egreso  timestamptz,
  -- El triage solo aplica (y es obligatorio) en urgencias.
  CONSTRAINT admisiones_triage_urgencias CHECK ((servicio = 'urgencias') = (triage IS NOT NULL))
);
CREATE INDEX admisiones_paciente_idx ON admisiones (paciente_id);
CREATE INDEX admisiones_estado_idx ON admisiones (estado, fecha_ingreso);

CREATE TABLE documentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id     uuid         NOT NULL REFERENCES pacientes (id),
  tipo            varchar(30)  NOT NULL
                  CHECK (tipo IN ('orden', 'resultado_laboratorio', 'epicrisis', 'consentimiento', 'otro')),
  s3_key          varchar(300) NOT NULL UNIQUE,
  nombre_original varchar(255) NOT NULL,
  content_type    varchar(50)  NOT NULL,
  tamano_bytes    integer      NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 10485760),
  sha256          char(64)     NOT NULL,
  subido_por      varchar(150),
  subido_en       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX documentos_paciente_idx ON documentos (paciente_id);

-- Tabla de solo inserción: el rol de la aplicación no tiene UPDATE ni DELETE (ver migrate.js).
CREATE TABLE auditoria (
  id            bigserial PRIMARY KEY,
  usuario_sub   varchar(64),
  usuario_email varchar(150),
  rol           varchar(80),
  accion        varchar(50)  NOT NULL,
  recurso       varchar(50)  NOT NULL,
  recurso_id    varchar(64),
  ip            varchar(64),
  user_agent    varchar(300),
  ocurrido_en   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_ocurrido_idx ON auditoria (ocurrido_en);
