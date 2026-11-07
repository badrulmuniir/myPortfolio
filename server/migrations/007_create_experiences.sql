-- 007_create_experiences.sql
CREATE TABLE experiences (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_title        VARCHAR(100)  NOT NULL,
  company_name     VARCHAR(100)  NOT NULL,
  employment_type  VARCHAR(20)   NOT NULL
                   CHECK (employment_type IN ('Full-time','Part-time','Internship','Contract','Freelance','Volunteer')),
  start_date       DATE          NOT NULL,
  end_date         DATE,
  description      VARCHAR(5000) NOT NULL DEFAULT '',
  responsibilities TEXT[]        NOT NULL DEFAULT '{}' CHECK (cardinality(responsibilities) <= 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT experiences_end_after_start CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TRIGGER experiences_set_updated_at
  BEFORE UPDATE ON experiences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
