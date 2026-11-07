-- 009_create_contact_messages.sql
CREATE TABLE contact_messages (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(100)  NOT NULL,
  email      VARCHAR(254)  NOT NULL,
  subject    VARCHAR(150)  NOT NULL,
  message    VARCHAR(5000) NOT NULL,
  is_read    BOOLEAN       NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX contact_messages_read_created_idx ON contact_messages (is_read, created_at);
