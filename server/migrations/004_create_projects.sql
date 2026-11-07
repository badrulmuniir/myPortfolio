-- 004_create_projects.sql
CREATE TABLE projects (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title             VARCHAR(150)  NOT NULL,
  slug              VARCHAR(160)  NOT NULL UNIQUE
                    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND slug ~ '[a-z]'),
  short_description VARCHAR(300)  NOT NULL,
  full_description  VARCHAR(10000) NOT NULL DEFAULT '',
  problem_statement VARCHAR(10000) NOT NULL DEFAULT '',
  objectives        VARCHAR(10000) NOT NULL DEFAULT '',
  challenges        VARCHAR(10000) NOT NULL DEFAULT '',
  solutions         VARCHAR(10000) NOT NULL DEFAULT '',
  category          VARCHAR(50)   NOT NULL,
  image_url         VARCHAR(2048) NOT NULL DEFAULT '',
  github_url        VARCHAR(2048) NOT NULL DEFAULT '',
  live_demo_url     VARCHAR(2048) NOT NULL DEFAULT '',
  features          TEXT[]        NOT NULL DEFAULT '{}' CHECK (cardinality(features) <= 30),
  is_published      BOOLEAN       NOT NULL DEFAULT false,
  display_order     INTEGER       NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 9999),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_published_order_idx ON projects (is_published, display_order);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
