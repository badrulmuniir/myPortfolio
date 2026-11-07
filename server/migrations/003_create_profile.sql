-- 003_create_profile.sql
-- Single-row table: id is always 1.
CREATE TABLE profile (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name                  VARCHAR(100)  NOT NULL,
  professional_title    VARCHAR(100)  NOT NULL,
  personal_introduction VARCHAR(5000) NOT NULL DEFAULT '',
  biography             VARCHAR(5000) NOT NULL DEFAULT '',
  career_interests      VARCHAR(5000) NOT NULL DEFAULT '',
  professional_goals    VARCHAR(5000) NOT NULL DEFAULT '',
  profile_image_url     VARCHAR(2048) NOT NULL DEFAULT '',
  email                 VARCHAR(254)  NOT NULL,
  github_url            VARCHAR(2048) NOT NULL DEFAULT '',
  linkedin_url          VARCHAR(2048) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER profile_set_updated_at
  BEFORE UPDATE ON profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
