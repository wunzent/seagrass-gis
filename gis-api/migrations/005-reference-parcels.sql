CREATE TABLE reference_parcels (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref_id bigint NOT NULL UNIQUE,
  density text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  tile_geom geometry(MultiPolygon, 3857) GENERATED ALWAYS AS (ST_Transform(geom, 3857)) STORED
);

CREATE INDEX reference_parcels_geom_gix ON reference_parcels USING gist (geom);
CREATE INDEX reference_parcels_tile_geom_gix ON reference_parcels USING gist (tile_geom);
