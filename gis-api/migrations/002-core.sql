CREATE TABLE provinces (
  code varchar(2) PRIMARY KEY,
  name_th text NOT NULL,
  geom geometry(MultiPolygon,4326) NOT NULL CHECK (NOT ST_IsEmpty(geom) AND ST_IsValid(geom))
);
CREATE TABLE species (
  code varchar(16) PRIMARY KEY,
  name_th text NOT NULL,
  name_sci text NOT NULL
);
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer','editor','admin'))
);
CREATE TABLE sites (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name text NOT NULL,
  province_code varchar(2) NOT NULL REFERENCES provinces(code),
  geom geometry(MultiPolygon,4326) NOT NULL CHECK (NOT ST_IsEmpty(geom) AND ST_IsValid(geom)),
  area_rai numeric NOT NULL CHECK (area_rai >= 0 AND area_rai < 'Infinity'::numeric),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  deleted_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE surveys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  survey_ref text UNIQUE,
  geom geometry(Point,4326) NOT NULL CHECK (NOT ST_IsEmpty(geom) AND ST_IsValid(geom)),
  surveyed_on date NOT NULL,
  cover_percent numeric NOT NULL CHECK (cover_percent >= 0 AND cover_percent <= 100),
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE survey_species (
  survey_id bigint NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  species_code varchar(16) NOT NULL REFERENCES species(code),
  PRIMARY KEY (survey_id, species_code)
);
