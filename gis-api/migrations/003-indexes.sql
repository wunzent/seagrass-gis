CREATE INDEX provinces_geom_idx ON provinces USING gist(geom);
CREATE INDEX sites_geom_idx ON sites USING gist(geom);
CREATE INDEX surveys_geom_idx ON surveys USING gist(geom);
CREATE UNIQUE INDEX sites_active_code_idx ON sites(code) WHERE deleted_at IS NULL;
CREATE INDEX sites_province_code_idx ON sites(province_code);
CREATE INDEX surveys_site_date_idx ON surveys(site_id, surveyed_on DESC, id DESC);
