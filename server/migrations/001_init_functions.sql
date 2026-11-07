-- 001_init_functions.sql
-- Trigger functions that maintain timestamp columns on UPDATE (Requirement 2.10).
-- Attached as BEFORE UPDATE ... FOR EACH ROW by the table migrations.

-- For tables with both created_at and updated_at.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := GREATEST(now(), OLD.updated_at);   -- never moves backwards (2.10)
  NEW.created_at := OLD.created_at;                    -- created_at is immutable
  RETURN NEW;
END $$;

-- For tables with updated_at only (settings). set_updated_at() cannot be used there,
-- because assigning NEW.created_at fails on a row type that has no created_at column.
CREATE FUNCTION set_updated_at_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := GREATEST(now(), OLD.updated_at);   -- never moves backwards (2.10)
  RETURN NEW;
END $$;
