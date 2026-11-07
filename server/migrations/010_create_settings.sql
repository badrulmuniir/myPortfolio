-- 010_create_settings.sql
CREATE TABLE settings (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  setting_key   VARCHAR(50) NOT NULL UNIQUE
                CHECK (setting_key IN ('site_title', 'hero_introduction', 'footer_text', 'social_links')),
  setting_value JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- settings has no created_at column, so it uses set_updated_at_only().
CREATE TRIGGER settings_set_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_only();
