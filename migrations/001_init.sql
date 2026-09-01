create table if not exists gtm_catalog_records (
  id text primary key,
  record_type text not null,
  key text not null,
  name text not null,
  summary text,
  attributes jsonb not null default '{}',
  sensitivity text not null default 'internal',
  lifecycle text not null default 'active',
  verification_state text not null default 'unverified',
  last_verified_at timestamptz,
  source_url text,
  source_updated_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(record_type, key),
  check (record_type in ('person','team','agency','vendor','system','account','integration','data_term','data_field','measurement_asset','runbook','policy','report')),
  check (sensitivity in ('internal','restricted')),
  check (lifecycle in ('draft','active','inactive','deprecated')),
  check (verification_state in ('unverified','verified','stale','conflict'))
);

create table if not exists gtm_catalog_relationships (
  id text primary key,
  from_record_id text not null references gtm_catalog_records(id),
  to_record_id text not null references gtm_catalog_records(id),
  relationship_type text not null,
  is_primary boolean not null default false,
  context jsonb not null default '{}',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique(from_record_id, to_record_id, relationship_type),
  check (from_record_id <> to_record_id),
  check (status in ('active','inactive'))
);

create table if not exists gtm_bulk_templates (
  id text primary key,
  key text not null unique,
  name text not null,
  platform_key text not null,
  object_type text not null,
  operation text not null,
  format text not null default 'csv',
  columns jsonb not null default '[]',
  examples jsonb not null default '[]',
  max_rows integer,
  availability_notes text,
  docs_url text,
  verification_state text not null default 'draft',
  lifecycle text not null default 'active',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  check (format in ('csv','json')),
  check (verification_state in ('draft','verified','deprecated')),
  check (lifecycle in ('active','inactive','deprecated'))
);

create table if not exists gtm_source_connectors (
  id text primary key,
  key text not null unique,
  name text not null,
  source_type text not null,
  status text not null default 'paused',
  config jsonb not null default '{}',
  credential_ref text,
  schedule_minutes integer not null default 60,
  auto_apply boolean not null default false,
  authoritative_fields jsonb not null default '[]',
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_error text,
  lock_owner text,
  lock_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check (source_type in ('notion')),
  check (status in ('active','paused','error')),
  check (schedule_minutes >= 5)
);

create table if not exists gtm_source_records (
  id text primary key,
  connector_id text not null references gtm_source_connectors(id),
  external_id text not null,
  internal_record_id text references gtm_catalog_records(id),
  source_url text,
  content_hash text not null,
  source_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  payload jsonb not null,
  status text not null default 'proposed',
  unique(connector_id, external_id),
  check (status in ('current','proposed','conflict','ignored','deleted'))
);

create table if not exists gtm_change_proposals (
  id text primary key,
  connector_id text not null references gtm_source_connectors(id),
  source_record_id text not null references gtm_source_records(id),
  internal_record_id text references gtm_catalog_records(id),
  proposal_type text not null,
  before jsonb,
  after jsonb not null,
  diff jsonb not null default '{}',
  status text not null default 'pending',
  reason text,
  decided_by text,
  decided_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposal_type in ('create','update','deactivate')),
  check (status in ('pending','approved','rejected','applied','superseded'))
);

create table if not exists gtm_source_sync_runs (
  id text primary key,
  connector_id text not null references gtm_source_connectors(id),
  trigger text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  seen_count integer not null default 0,
  changed_count integer not null default 0,
  applied_count integer not null default 0,
  proposed_count integer not null default 0,
  error text,
  check (trigger in ('schedule','manual','webhook')),
  check (status in ('running','succeeded','failed','skipped'))
);

create table if not exists gtm_audit_events (
  id text primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists gtm_catalog_search_idx on gtm_catalog_records(record_type, lifecycle);
create index if not exists gtm_relationship_from_idx on gtm_catalog_relationships(from_record_id, status);
create index if not exists gtm_relationship_to_idx on gtm_catalog_relationships(to_record_id, status);
create index if not exists gtm_proposal_status_idx on gtm_change_proposals(status, created_at desc);
create index if not exists gtm_sync_run_connector_idx on gtm_source_sync_runs(connector_id, started_at desc);
