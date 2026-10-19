-- schema.sql — Fifty Tracker Phase 2 schema
-- Auto-runs on server boot, idempotent (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
-- Re-running this file is safe; partial UNIQUE indexes use CREATE UNIQUE INDEX IF NOT EXISTS.
-- CHECK constraints are added in DO blocks (Postgres has no ADD CONSTRAINT IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id                            SERIAL PRIMARY KEY,
  name                          TEXT NOT NULL,
  client                        TEXT,
  description                   TEXT,
  owner_id                      INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_state                 TEXT NOT NULL,
  original_delivery_date        DATE,
  original_delivery_acknowledged BOOLEAN NOT NULL DEFAULT false,
  archived_at                   TIMESTAMPTZ,
  archived_reason               TEXT,
  version                       INT NOT NULL DEFAULT 1,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_state_check') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_state_check
      CHECK (project_state IN ('new_build','already_built'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_name_len') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_name_len CHECK (char_length(name) BETWEEN 1 AND 200);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived_at);
CREATE INDEX IF NOT EXISTS idx_projects_state ON projects(project_state);

-- ============================================================
-- project_members (many-to-many: project <-> user)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_members (
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

-- ============================================================
-- project_links
-- ============================================================
CREATE TABLE IF NOT EXISTS project_links (
  id         SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_links_label_len') THEN
    ALTER TABLE project_links ADD CONSTRAINT project_links_label_len CHECK (char_length(label) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_links_url_len') THEN
    ALTER TABLE project_links ADD CONSTRAINT project_links_url_len CHECK (char_length(url) BETWEEN 1 AND 500);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_links_project ON project_links(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_links_label
  ON project_links(project_id, label);

-- ============================================================
-- phases
-- ============================================================
CREATE TABLE IF NOT EXISTS phases (
  id              SERIAL PRIMARY KEY,
  project_id      INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number          INT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL,
  waiting_reason  TEXT,
  hold_reason     TEXT,
  deadline        DATE,
  activated_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  archived_reason TEXT,
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phases_status_check') THEN
    ALTER TABLE phases ADD CONSTRAINT phases_status_check
      CHECK (status IN ('planned','active','waiting_for_client','on_hold','completed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phases_waiting_reason') THEN
    ALTER TABLE phases ADD CONSTRAINT phases_waiting_reason
      CHECK ((status <> 'waiting_for_client') OR (waiting_reason IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phases_hold_reason') THEN
    ALTER TABLE phases ADD CONSTRAINT phases_hold_reason
      CHECK ((status <> 'on_hold') OR (hold_reason IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phases_number_pos') THEN
    ALTER TABLE phases ADD CONSTRAINT phases_number_pos CHECK (number > 0);
  END IF;
END $$;

-- UNIQUE phase number per non-archived project
CREATE UNIQUE INDEX IF NOT EXISTS uq_phases_number_per_project
  ON phases(project_id, number)
  WHERE archived_at IS NULL;

-- SINGLE active phase per project (excludes archived)
CREATE UNIQUE INDEX IF NOT EXISTS uq_phases_single_active
  ON phases(project_id)
  WHERE status = 'active' AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_phases_project ON phases(project_id);
CREATE INDEX IF NOT EXISTS idx_phases_status ON phases(status);
CREATE INDEX IF NOT EXISTS idx_phases_deadline ON phases(deadline) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_phases_archived ON phases(archived_at);

-- ============================================================
-- edits
-- ============================================================
CREATE TABLE IF NOT EXISTS edits (
  id                  SERIAL PRIMARY KEY,
  phase_id            INT NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  assignee_id         INT REFERENCES users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'to_do',
  waiting_reason      TEXT,
  cancellation_reason TEXT,
  deadline            DATE,
  completed_at        TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  archived_reason     TEXT,
  version             INT NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edits_status_check') THEN
    ALTER TABLE edits ADD CONSTRAINT edits_status_check
      CHECK (status IN ('to_do','in_progress','testing','waiting','done','cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edits_waiting_reason') THEN
    ALTER TABLE edits ADD CONSTRAINT edits_waiting_reason
      CHECK ((status <> 'waiting') OR (waiting_reason IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edits_cancellation_reason') THEN
    ALTER TABLE edits ADD CONSTRAINT edits_cancellation_reason
      CHECK ((status <> 'cancelled') OR (cancellation_reason IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edits_title_len') THEN
    ALTER TABLE edits ADD CONSTRAINT edits_title_len CHECK (char_length(title) BETWEEN 1 AND 200);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_edits_phase ON edits(phase_id);
CREATE INDEX IF NOT EXISTS idx_edits_assignee ON edits(assignee_id);
CREATE INDEX IF NOT EXISTS idx_edits_status ON edits(status);
CREATE INDEX IF NOT EXISTS idx_edits_deadline ON edits(deadline) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_edits_archived ON edits(archived_at);

-- ============================================================
-- notes (on edits)
-- ============================================================
CREATE TABLE IF NOT EXISTS notes (
  id         SERIAL PRIMARY KEY,
  edit_id    INT NOT NULL REFERENCES edits(id) ON DELETE CASCADE,
  author_id  INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_body_len') THEN
    ALTER TABLE notes ADD CONSTRAINT notes_body_len CHECK (char_length(body) BETWEEN 1 AND 5000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notes_edit ON notes(edit_id);
CREATE INDEX IF NOT EXISTS idx_notes_author ON notes(author_id);

-- ============================================================
-- activity_events (audit log per project)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_events (
  id         SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id  INT,
  actor_id   INT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  reason     TEXT,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_entity_type_check') THEN
    ALTER TABLE activity_events ADD CONSTRAINT activity_entity_type_check
      CHECK (entity_type IN ('project','phase','edit','note','link','member'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activity_project_ts ON activity_events(project_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_events(actor_id);

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_phases_updated_at ON phases;
CREATE TRIGGER trg_phases_updated_at
  BEFORE UPDATE ON phases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_edits_updated_at ON edits;
CREATE TRIGGER trg_edits_updated_at
  BEFORE UPDATE ON edits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
