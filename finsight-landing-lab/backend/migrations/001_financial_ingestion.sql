-- FinSight Phase 1 schema. Safe to inspect and re-run; no existing records are deleted.
create table if not exists public.financial_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'needs_review', 'failed')),
  error_message text,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  sha256 text not null,
  storage_bucket text not null default 'financial-uploads',
  storage_path text,
  row_count integer check (row_count is null or row_count >= 0),
  column_count integer check (column_count is null or column_count >= 0),
  mapping_review_count integer not null default 0 check (mapping_review_count >= 0),
  company_name text,
  encoding text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.raw_financial_rows (
  id uuid primary key default gen_random_uuid(),
  source_upload_id uuid not null references public.financial_uploads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  row_number integer not null check (row_number >= 2),
  raw_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (source_upload_id, row_number)
);

-- One generic registry row per uploaded source column; this does not alter per-header schema.
create table if not exists public.financial_upload_fields (
  id uuid primary key default gen_random_uuid(),
  source_upload_id uuid not null references public.financial_uploads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  source_header text not null,
  candidate_identifier text not null,
  canonical_identifier text,
  statement_type text,
  field_role text not null check (field_role in ('metric', 'metadata', 'line_item')),
  inferred_type text not null check (inferred_type in ('numeric', 'text', 'date', 'boolean', 'mixed')),
  value_count integer not null default 0 check (value_count >= 0),
  mapping_status text not null check (mapping_status in ('mapped', 'unmapped', 'ambiguous', 'invalid', 'missing', 'metadata')),
  created_at timestamptz not null default now(),
  unique (source_upload_id, ordinal)
);

-- Flexible line-item table; new financial fields do not require schema changes.
create table if not exists public.financial_statements (
  id uuid primary key default gen_random_uuid(),
  source_upload_id uuid not null references public.financial_uploads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  statement_type text not null,
  field_name text not null,
  value numeric,
  raw_value text not null default '',
  period text,
  period_kind text not null default 'unknown'
    check (period_kind in ('instant', 'duration', 'unknown')),
  currency text,
  unit text,
  source_column text,
  source_row_number integer not null check (source_row_number >= 2),
  mapping_status text not null
    check (mapping_status in ('mapped', 'unmapped', 'ambiguous', 'invalid', 'missing')),
  mapping_version text not null,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ratio_results (
  id uuid primary key default gen_random_uuid(),
  source_upload_id uuid not null references public.financial_uploads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text,
  period text,
  ratio_identifier text not null,
  calculated_value numeric,
  unit text not null,
  calculation_status text not null
    check (calculation_status in ('calculated', 'unavailable', 'invalid')),
  formula_version text not null,
  calculated_at timestamptz not null default now(),
  input_values jsonb not null default '[]'::jsonb,
  reason text
);

create index if not exists financial_uploads_user_created_idx
  on public.financial_uploads (user_id, created_at desc);
create index if not exists raw_financial_rows_upload_idx
  on public.raw_financial_rows (user_id, source_upload_id, row_number);
create index if not exists financial_upload_fields_lookup_idx
  on public.financial_upload_fields (user_id, source_upload_id, ordinal);
create index if not exists financial_statements_lookup_idx
  on public.financial_statements (user_id, source_upload_id, statement_type, period, field_name);
create index if not exists financial_statements_review_idx
  on public.financial_statements (user_id, source_upload_id, mapping_status);
create index if not exists ratio_results_lookup_idx
  on public.ratio_results (user_id, source_upload_id, period, ratio_identifier);

alter table public.financial_uploads enable row level security;
alter table public.raw_financial_rows enable row level security;
alter table public.financial_upload_fields enable row level security;
alter table public.financial_statements enable row level security;
alter table public.ratio_results enable row level security;

grant select on public.financial_uploads, public.raw_financial_rows,
  public.financial_upload_fields, public.financial_statements, public.ratio_results to authenticated;
grant all on public.financial_uploads, public.raw_financial_rows,
  public.financial_upload_fields, public.financial_statements, public.ratio_results to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_uploads' and policyname = 'Users can read their financial uploads') then
    create policy "Users can read their financial uploads" on public.financial_uploads for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'raw_financial_rows' and policyname = 'Users can read their raw financial rows') then
    create policy "Users can read their raw financial rows" on public.raw_financial_rows for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_upload_fields' and policyname = 'Users can read their discovered financial fields') then
    create policy "Users can read their discovered financial fields" on public.financial_upload_fields for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_statements' and policyname = 'Users can read their financial statements') then
    create policy "Users can read their financial statements" on public.financial_statements for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ratio_results' and policyname = 'Users can read their ratio results') then
    create policy "Users can read their ratio results" on public.ratio_results for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;

-- Backend uses the service role for writes. Browser access is read-only and owner-scoped.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('financial-uploads', 'financial-uploads', false, 10485760, array['text/csv', 'application/vnd.ms-excel', 'application/octet-stream'])
on conflict (id) do update set public = false;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Users can read their private financial uploads') then
    create policy "Users can read their private financial uploads"
      on storage.objects for select to authenticated
      using (bucket_id = 'financial-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
