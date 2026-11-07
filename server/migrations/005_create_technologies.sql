-- 005_create_technologies.sql
CREATE TABLE technologies (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(50) NOT NULL CHECK (btrim(name) <> ''),
  category   VARCHAR(50) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness (2.2). A UNIQUE constraint cannot hold an expression,
-- so a unique expression index is used instead.
CREATE UNIQUE INDEX technologies_name_lower_key ON technologies (lower(name));

CREATE TABLE project_technologies (
  project_id    INTEGER NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
  technology_id INTEGER NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, technology_id)
);

CREATE INDEX project_technologies_technology_idx ON project_technologies (technology_id);
