CREATE TABLE IF NOT EXISTS archive_records (
  record_type TEXT NOT NULL,
  record_key TEXT NOT NULL,
  operational_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_updated_at TEXT NOT NULL DEFAULT '',
  archived_at TEXT NOT NULL,
  updated_by_uid TEXT NOT NULL,
  updated_by_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (record_type, record_key),
  CHECK (record_type IN ('night-duty', 'in-house', 'room-property-status')),
  CHECK (length(payload_json) <= 250000)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_archive_records_type_date
  ON archive_records (record_type, operational_date);

CREATE TABLE IF NOT EXISTS archive_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL,
  record_key TEXT NOT NULL,
  operational_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_updated_at TEXT NOT NULL DEFAULT '',
  archived_at TEXT NOT NULL,
  updated_by_uid TEXT NOT NULL,
  updated_by_name TEXT NOT NULL DEFAULT '',
  CHECK (record_type IN ('night-duty', 'in-house', 'room-property-status')),
  CHECK (length(payload_json) <= 250000)
);

CREATE INDEX IF NOT EXISTS idx_archive_revisions_record
  ON archive_revisions (record_type, record_key, revision_id DESC);

CREATE INDEX IF NOT EXISTS idx_archive_revisions_type_date
  ON archive_revisions (record_type, operational_date);

CREATE TABLE IF NOT EXISTS archive_coverage (
  record_type TEXT NOT NULL,
  operational_date TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  checked_by_uid TEXT NOT NULL,
  PRIMARY KEY (record_type, operational_date),
  CHECK (record_type IN ('night-duty', 'in-house', 'room-property-status'))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_archive_coverage_type_date
  ON archive_coverage (record_type, operational_date);
