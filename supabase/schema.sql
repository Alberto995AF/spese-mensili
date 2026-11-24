-- Spese Mensili: archivio della famiglia su Supabase.
-- Da eseguire in Supabase → SQL Editor → New query → incolla tutto → Run (si può rieseguire senza danni).
-- Le email abilitate si aggiungono in fondo, una volta creati gli utenti.

-- Chi può entrare: solo queste email.
create table if not exists public.members (
  email text primary key
);

-- Tutti i dati dell'app, una riga per elemento:
--   kind = 'mov' (movimento), 'rec' (ricorrente), 'imp' (importazione), 'cfg' (configurazione)
create table if not exists public.items (
  kind       text        not null check (kind in ('mov','rec','imp','cfg')),
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by uuid        default auth.uid(),
  primary key (kind, id)
);

create or replace function public.touch_items() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.touch_items();

-- È un membro della famiglia chi ha fatto l'accesso con un'email presente in members.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where lower(m.email) = lower(auth.jwt() ->> 'email'))
$$;

alter table public.members enable row level security;
alter table public.items   enable row level security;

-- Accesso dalle API: solo per chi ha fatto l'accesso (mai per i visitatori anonimi).
revoke all on public.members, public.items from anon;
grant select on public.members to authenticated;
grant select, insert, update, delete on public.items to authenticated;
grant execute on function public.is_member() to authenticated;
revoke truncate, references, trigger on public.items, public.members from authenticated;

drop policy if exists "vedo la mia email" on public.members;
create policy "vedo la mia email" on public.members
  for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "famiglia legge"     on public.items;
drop policy if exists "famiglia inserisce" on public.items;
drop policy if exists "famiglia modifica"  on public.items;
drop policy if exists "famiglia cancella"  on public.items;
create policy "famiglia legge"     on public.items for select to authenticated using (public.is_member());
create policy "famiglia inserisce" on public.items for insert to authenticated with check (public.is_member());
create policy "famiglia modifica"  on public.items for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "famiglia cancella"  on public.items for delete to authenticated using (public.is_member());

-- Aggiornamenti in tempo reale fra PC e telefono.
alter table public.items replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null; end $$;

-- ▼▼▼ Le email della famiglia (le stesse degli utenti in Authentication → Users) ▼▼▼
-- Per aggiungere qualcuno più avanti basta eseguire di nuovo solo questa riga con la sua email:
-- insert into public.members (email) values ('nome@esempio.it') on conflict do nothing;
