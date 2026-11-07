-- 006_create_skills.sql
CREATE TABLE skills (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              VARCHAR(50)   NOT NULL,
  category          VARCHAR(50)   NOT NULL,
  proficiency_level VARCHAR(20)   NOT NULL DEFAULT ''
                    CHECK (proficiency_level IN ('', 'Beginner', 'Intermediate', 'Advanced', 'Expert')),
  icon_url          VARCHAR(2048) NOT NULL DEFAULT '',
  display_order     INTEGER       NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 9999),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX skills_category_order_idx ON skills (category, display_order);

CREATE TRIGGER skills_set_updated_at
  BEFORE UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
