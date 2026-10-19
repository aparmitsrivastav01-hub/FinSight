-- Additive, rerunnable schema for per-upload dynamic source-column discovery.
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

create index if not exists financial_upload_fields_lookup_idx
  on public.financial_upload_fields (user_id, source_upload_id, ordinal);

alter table public.financial_upload_fields enable row level security;
grant select on public.financial_upload_fields to authenticated;
grant all on public.financial_upload_fields to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'financial_upload_fields'
      and policyname = 'Users can read their discovered financial fields'
  ) then
    create policy "Users can read their discovered financial fields"
      on public.financial_upload_fields
      for select to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;
