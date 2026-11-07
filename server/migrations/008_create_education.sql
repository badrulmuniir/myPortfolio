-- 008_create_education.sql
-- The end_year upper bound (current year + 10) changes over time, so only the Validator enforces it.
CREATE TABLE education (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution    VARCHAR(150)  NOT NULL,
  qualification  VARCHAR(150)  NOT NULL,
  field_of_study VARCHAR(150)  NOT NULL DEFAULT '',
  start_year     INTEGER       NOT NULL CHECK (start_year >= 1950),
  end_year       INTEGER,
  description    VARCHAR(5000) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT education_end_after_start CHECK (end_year IS NULL OR end_year >= start_year)
);

CREATE TRIGGER education_set_updated_at
  BEFORE UPDATE ON education
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
