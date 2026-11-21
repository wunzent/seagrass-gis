CREATE TABLE access_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX access_sessions_user_id_idx ON access_sessions(user_id);
CREATE INDEX access_sessions_expires_at_idx ON access_sessions(expires_at);
