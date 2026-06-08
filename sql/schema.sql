-- =========================================================
-- SeaPodADU — Schema completo
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- =========================================================

-- ENUMS
create type if not exists public.app_role as enum ('director', 'agente');
create type if not exists public.lead_state as enum ('No Atendido', 'No Interesado', 'Interesado', 'Cita');
create type if not exists public.link_channel as enum ('qr', 'sms');

-- =========================================================
-- USER ROLES
-- =========================================================
create table if not exists public.user_roles (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role    public.app_role not null,
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all    on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  );
$$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='user_roles' and policyname='user can read own roles'
  ) then
    create policy "user can read own roles"
      on public.user_roles for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- =========================================================
-- AGENTS
-- =========================================================
create table if not exists public.agents (
  id         text primary key,
  user_id    uuid unique references auth.users(id) on delete set null,
  name       text not null,
  email      text not null unique,
  phone      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

grant select           on public.agents to authenticated;
grant insert, update, delete on public.agents to service_role;
alter table public.agents enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='agents' and policyname='agentes ven su propio registro') then
    create policy "agentes ven su propio registro"
      on public.agents for select to authenticated
      using (user_id = auth.uid() or public.has_role(auth.uid(), 'director'));
  end if;
  if not exists (select 1 from pg_policies where tablename='agents' and policyname='director gestiona agentes') then
    create policy "director gestiona agentes"
      on public.agents for all to authenticated
      using (public.has_role(auth.uid(), 'director'))
      with check (public.has_role(auth.uid(), 'director'));
  end if;
end $$;

-- =========================================================
-- DOOR KNOCKS
-- =========================================================
create table if not exists public.door_knocks (
  id                   uuid primary key default gen_random_uuid(),
  agent_id             text not null references public.agents(id) on delete cascade,
  address              text not null,
  gps_address          text,
  city                 text not null,
  lat                  double precision not null,
  lng                  double precision not null,
  state                public.lead_state not null default 'No Atendido',
  timestamp            timestamptz not null default now(),
  updated_at           timestamptz,
  feasibility_checked  boolean not null default false,
  feasibility_passed   boolean,
  approved_sqft        integer,
  lead_fecha           date,
  lead_direccion       text,
  lead_nombre          text,
  lead_telefono        text,
  lead_correo          text,
  appointment_datetime timestamptz,
  appointment_attended boolean,
  notes                text
);

create index if not exists door_knocks_agent_id_idx on public.door_knocks (agent_id);
create index if not exists door_knocks_state_idx    on public.door_knocks (state);
create index if not exists door_knocks_timestamp_idx on public.door_knocks (timestamp desc);

grant select, insert, update on public.door_knocks to authenticated;
grant all                     on public.door_knocks to service_role;
alter table public.door_knocks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='door_knocks' and policyname='agente lee sus toques') then
    create policy "agente lee sus toques"
      on public.door_knocks for select to authenticated
      using (
        public.has_role(auth.uid(), 'director')
        or agent_id in (select id from public.agents where user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where tablename='door_knocks' and policyname='agente inserta sus toques') then
    create policy "agente inserta sus toques"
      on public.door_knocks for insert to authenticated
      with check (agent_id in (select id from public.agents where user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='door_knocks' and policyname='agente actualiza sus toques') then
    create policy "agente actualiza sus toques"
      on public.door_knocks for update to authenticated
      using (
        public.has_role(auth.uid(), 'director')
        or agent_id in (select id from public.agents where user_id = auth.uid())
      );
  end if;
end $$;

-- =========================================================
-- CLIENT LINKS (QR / SMS handshake)
-- =========================================================
create table if not exists public.client_links (
  token      text primary key,
  knock_id   uuid not null references public.door_knocks(id) on delete cascade,
  agent_id   text not null references public.agents(id) on delete cascade,
  channel    public.link_channel not null,
  created_at timestamptz not null default now(),
  consumed   boolean not null default false
);

create index if not exists client_links_agent_id_idx on public.client_links (agent_id);

grant select on public.client_links to anon;
grant select, insert, update on public.client_links to authenticated;
grant all on public.client_links to service_role;
alter table public.client_links enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='client_links' and policyname='lookup publico por token') then
    create policy "lookup publico por token"
      on public.client_links for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='client_links' and policyname='agente gestiona sus links') then
    create policy "agente gestiona sus links"
      on public.client_links for all to authenticated
      using (
        public.has_role(auth.uid(), 'director')
        or agent_id in (select id from public.agents where user_id = auth.uid())
      )
      with check (agent_id in (select id from public.agents where user_id = auth.uid()));
  end if;
end $$;

-- =========================================================
-- MATCH EVENTS (notificación en vivo al agente)
-- =========================================================
create table if not exists public.match_events (
  id          uuid primary key default gen_random_uuid(),
  agent_id    text not null references public.agents(id) on delete cascade,
  knock_id    uuid not null references public.door_knocks(id) on delete cascade,
  sqft        integer not null,
  client_name text not null,
  at          timestamptz not null default now()
);

create index if not exists match_events_agent_at_idx on public.match_events (agent_id, at desc);

grant select, delete on public.match_events to authenticated;
grant all            on public.match_events to service_role;
alter table public.match_events enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='match_events' and policyname='agente ve sus eventos') then
    create policy "agente ve sus eventos"
      on public.match_events for select to authenticated
      using (
        public.has_role(auth.uid(), 'director')
        or agent_id in (select id from public.agents where user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where tablename='match_events' and policyname='agente descarta sus eventos') then
    create policy "agente descarta sus eventos"
      on public.match_events for delete to authenticated
      using (agent_id in (select id from public.agents where user_id = auth.uid()));
  end if;
end $$;

-- Habilitar Realtime para notificaciones en vivo al agente:
-- alter publication supabase_realtime add table public.match_events;
