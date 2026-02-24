-- Ejecuta este script DESPUES de:
-- 1) haber corrido supabase/schema.sql
-- 2) tener al menos un usuario creado en Supabase Auth (email/password)
--
-- Objetivo:
-- - agregar owner_id a products/stock/inventory_movements
-- - limitar lecturas/escrituras por usuario autenticado
-- - asegurar la RPC record_inventory_movement para no permitir stock negativo
--   y solo operar datos del owner autenticado

alter table public.products add column if not exists owner_id uuid references auth.users(id);
alter table public.stock add column if not exists owner_id uuid references auth.users(id);
alter table public.inventory_movements add column if not exists owner_id uuid references auth.users(id);

-- Backfill simple para MVP (asigna registros existentes al primer usuario creado, si existe)
with first_user as (
  select id from auth.users order by created_at asc limit 1
)
update public.products p
set owner_id = fu.id
from first_user fu
where p.owner_id is null;

update public.stock s
set owner_id = p.owner_id
from public.products p
where s.product_id = p.id
  and s.owner_id is null
  and p.owner_id is not null;

update public.inventory_movements m
set owner_id = p.owner_id
from public.products p
where m.product_id = p.id
  and m.owner_id is null
  and p.owner_id is not null;

alter table public.products alter column owner_id set default auth.uid();
alter table public.stock alter column owner_id set default auth.uid();
alter table public.inventory_movements alter column owner_id set default auth.uid();

-- Si ya tienes datos sin usuario y no quieres perderlos, crea primero un usuario y luego corre este script.
do $$
begin
  if exists (select 1 from public.products where owner_id is null) then
    raise notice 'Hay productos sin owner_id. Se mantendran inaccesibles hasta asignarlos.';
  end if;
end $$;

drop policy if exists products_all on public.products;
drop policy if exists stock_all on public.stock;
drop policy if exists inventory_movements_all on public.inventory_movements;

create policy products_select_own on public.products
for select to authenticated
using (owner_id = auth.uid());

create policy products_insert_own on public.products
for insert to authenticated
with check (owner_id = auth.uid());

create policy products_update_own on public.products
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy products_delete_own on public.products
for delete to authenticated
using (owner_id = auth.uid());

create policy stock_select_own on public.stock
for select to authenticated
using (owner_id = auth.uid());

create policy stock_insert_own on public.stock
for insert to authenticated
with check (owner_id = auth.uid());

create policy stock_update_own on public.stock
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy inventory_movements_select_own on public.inventory_movements
for select to authenticated
using (owner_id = auth.uid());

-- Bloquear inserts directos de movimientos y forzar uso de RPC
create policy inventory_movements_insert_own on public.inventory_movements
for insert to authenticated
with check (false);

drop function if exists public.record_inventory_movement(uuid, text, integer, text, text);

create or replace function public.record_inventory_movement(
  p_product_id uuid,
  p_type text,
  p_quantity integer,
  p_reason text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_product_min integer;
  v_stock_quantity integer;
  v_stock_min integer;
  v_next_quantity integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  if p_type not in ('IN', 'OUT') then
    raise exception 'Tipo de movimiento inválido.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.';
  end if;

  select min_stock
  into v_product_min
  from public.products
  where id = p_product_id
    and owner_id = v_user_id
  for update;

  if not found then
    raise exception 'El producto no existe o no te pertenece.';
  end if;

  select quantity, min_stock
  into v_stock_quantity, v_stock_min
  from public.stock
  where product_id = p_product_id
    and owner_id = v_user_id
  for update;

  if not found then
    insert into public.stock (product_id, owner_id, quantity, min_stock)
    values (p_product_id, v_user_id, 0, coalesce(v_product_min, 0));
    v_stock_quantity := 0;
    v_stock_min := coalesce(v_product_min, 0);
  end if;

  v_next_quantity := v_stock_quantity + case when p_type = 'IN' then p_quantity else -p_quantity end;

  if v_next_quantity < 0 then
    raise exception 'No se permite stock negativo.';
  end if;

  update public.stock
  set quantity = v_next_quantity,
      min_stock = coalesce(v_stock_min, v_product_min, 0),
      owner_id = v_user_id,
      updated_at = now()
  where product_id = p_product_id
    and owner_id = v_user_id;

  insert into public.inventory_movements (product_id, owner_id, type, quantity, reason, note)
  values (
    p_product_id,
    v_user_id,
    p_type,
    p_quantity,
    btrim(coalesce(p_reason, '')),
    btrim(coalesce(p_note, ''))
  );
end;
$$;

grant execute on function public.record_inventory_movement(uuid, text, integer, text, text)
to authenticated;

revoke execute on function public.record_inventory_movement(uuid, text, integer, text, text)
from anon;

-- =========================================================
-- EXTENSION V2: perfiles, roles, super admin, auditoria,
-- proveedores y relaciones producto-proveedor.
-- Ejecutar despues del bloque anterior.
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'admin' check (role in ('super_admin', 'admin', 'almacen', 'ventas')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role = 'super_admin'
  );
$$;

create or replace function public.is_admin_like()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in ('super_admin', 'admin')
  );
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce((select p.role from public.profiles p where p.id = auth.uid() and p.active = true), 'admin');
$$;

insert into public.profiles (id, email, full_name)
select u.id, coalesce(u.email, ''), coalesce(u.raw_user_meta_data->>'full_name', '')
from auth.users u
on conflict (id) do update
set email = excluded.email,
    updated_at = now();

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;

create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin_like());

create policy profiles_insert on public.profiles
for insert to authenticated
with check (id = auth.uid() or public.is_admin_like());

create policy profiles_update on public.profiles
for update to authenticated
using (id = auth.uid() or public.is_super_admin())
with check (
  (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()))
  or public.is_super_admin()
);

-- Auditoria de movimientos
alter table public.inventory_movements add column if not exists stock_before integer;
alter table public.inventory_movements add column if not exists stock_after integer;
alter table public.inventory_movements add column if not exists created_by uuid references auth.users(id);
alter table public.inventory_movements add column if not exists created_by_email text;

update public.inventory_movements
set created_by = coalesce(created_by, owner_id),
    created_by_email = coalesce(created_by_email, '')
where created_by is null or created_by_email is null;

-- Permisos de tablas base con rol
drop policy if exists products_select_own on public.products;
drop policy if exists products_insert_own on public.products;
drop policy if exists products_update_own on public.products;
drop policy if exists products_delete_own on public.products;
drop policy if exists stock_select_own on public.stock;
drop policy if exists stock_insert_own on public.stock;
drop policy if exists stock_update_own on public.stock;
drop policy if exists inventory_movements_select_own on public.inventory_movements;
drop policy if exists inventory_movements_insert_own on public.inventory_movements;

create policy products_select_role on public.products
for select to authenticated
using (
  owner_id = auth.uid()
  or public.current_user_role() in ('super_admin', 'admin', 'almacen', 'ventas')
);

create policy products_insert_role on public.products
for insert to authenticated
with check (
  (public.current_user_role() in ('super_admin', 'admin', 'almacen')) and
  (owner_id = auth.uid() or public.is_admin_like())
);

create policy products_update_role on public.products
for update to authenticated
using (owner_id = auth.uid() or public.is_admin_like())
with check (
  (public.current_user_role() in ('super_admin', 'admin', 'almacen')) and
  (owner_id = auth.uid() or public.is_admin_like())
);

create policy products_delete_role on public.products
for delete to authenticated
using (public.is_super_admin());

create policy stock_select_role on public.stock
for select to authenticated
using (
  owner_id = auth.uid()
  or public.current_user_role() in ('super_admin', 'admin', 'almacen')
);

create policy stock_insert_role on public.stock
for insert to authenticated
with check (
  (public.current_user_role() in ('super_admin', 'admin', 'almacen')) and
  (owner_id = auth.uid() or public.is_admin_like())
);

create policy stock_update_role on public.stock
for update to authenticated
using (owner_id = auth.uid() or public.is_admin_like())
with check (
  (public.current_user_role() in ('super_admin', 'admin', 'almacen')) and
  (owner_id = auth.uid() or public.is_admin_like())
);

create policy inventory_movements_select_role on public.inventory_movements
for select to authenticated
using (
  owner_id = auth.uid()
  or public.current_user_role() in ('super_admin', 'admin', 'almacen')
);

create policy inventory_movements_insert_blocked on public.inventory_movements
for insert to authenticated
with check (false);

-- Proveedores y relacion producto-proveedor
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  lead_time_days integer not null default 0,
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_suppliers (
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  owner_id uuid not null references auth.users(id) default auth.uid(),
  supplier_sku text,
  cost numeric(12, 2) not null default 0,
  min_order_qty integer not null default 1,
  preferred boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (product_id, supplier_id)
);

alter table public.products add column if not exists cost numeric(12, 2);
alter table public.products add column if not exists barcode text;
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists unit text;
alter table public.products add column if not exists location text;
alter table public.products add column if not exists supplier_id uuid references public.suppliers(id);
alter table public.products add column if not exists lead_time_days integer;

alter table public.suppliers enable row level security;
alter table public.product_suppliers enable row level security;

drop policy if exists suppliers_select_role on public.suppliers;
drop policy if exists suppliers_insert_role on public.suppliers;
drop policy if exists suppliers_update_role on public.suppliers;
drop policy if exists suppliers_delete_role on public.suppliers;
drop policy if exists product_suppliers_select_role on public.product_suppliers;
drop policy if exists product_suppliers_insert_role on public.product_suppliers;
drop policy if exists product_suppliers_update_role on public.product_suppliers;
drop policy if exists product_suppliers_delete_role on public.product_suppliers;

create policy suppliers_select_role on public.suppliers
for select to authenticated
using (owner_id = auth.uid() or public.is_admin_like());

create policy suppliers_insert_role on public.suppliers
for insert to authenticated
with check (
  public.current_user_role() in ('super_admin', 'admin', 'almacen')
  and (owner_id = auth.uid() or public.is_admin_like())
);

create policy suppliers_update_role on public.suppliers
for update to authenticated
using (owner_id = auth.uid() or public.is_admin_like())
with check (
  public.current_user_role() in ('super_admin', 'admin', 'almacen')
  and (owner_id = auth.uid() or public.is_admin_like())
);

create policy suppliers_delete_role on public.suppliers
for delete to authenticated
using (public.is_admin_like());

create policy product_suppliers_select_role on public.product_suppliers
for select to authenticated
using (owner_id = auth.uid() or public.is_admin_like());

create policy product_suppliers_insert_role on public.product_suppliers
for insert to authenticated
with check (
  public.current_user_role() in ('super_admin', 'admin', 'almacen')
  and (owner_id = auth.uid() or public.is_admin_like())
);

create policy product_suppliers_update_role on public.product_suppliers
for update to authenticated
using (owner_id = auth.uid() or public.is_admin_like())
with check (
  public.current_user_role() in ('super_admin', 'admin', 'almacen')
  and (owner_id = auth.uid() or public.is_admin_like())
);

create policy product_suppliers_delete_role on public.product_suppliers
for delete to authenticated
using (public.is_admin_like());

-- RPC con auditoria y permisos por rol
drop function if exists public.record_inventory_movement(uuid, text, integer, text, text);

create or replace function public.record_inventory_movement(
  p_product_id uuid,
  p_type text,
  p_quantity integer,
  p_reason text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_user_role text;
  v_user_email text;
  v_product_min integer;
  v_product_owner uuid;
  v_stock_quantity integer;
  v_stock_min integer;
  v_next_quantity integer;
  v_effective_owner uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  select role, email into v_user_role, v_user_email
  from public.profiles
  where id = v_user_id and active = true;

  if coalesce(v_user_role, '') = '' then
    raise exception 'No tienes perfil activo.';
  end if;

  if v_user_role not in ('super_admin', 'admin', 'almacen') then
    raise exception 'No tienes permisos para registrar movimientos.';
  end if;

  if p_type not in ('IN', 'OUT') then
    raise exception 'Tipo de movimiento invalido.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.';
  end if;

  select min_stock, owner_id
  into v_product_min, v_product_owner
  from public.products
  where id = p_product_id
    and (owner_id = v_user_id or v_user_role in ('super_admin', 'admin'))
  for update;

  if not found then
    raise exception 'El producto no existe o no tienes acceso.';
  end if;

  v_effective_owner := coalesce(v_product_owner, v_user_id);

  select quantity, min_stock
  into v_stock_quantity, v_stock_min
  from public.stock
  where product_id = p_product_id
    and owner_id = v_effective_owner
  for update;

  if not found then
    insert into public.stock (product_id, owner_id, quantity, min_stock)
    values (p_product_id, v_effective_owner, 0, coalesce(v_product_min, 0));
    v_stock_quantity := 0;
    v_stock_min := coalesce(v_product_min, 0);
  end if;

  v_next_quantity := v_stock_quantity + case when p_type = 'IN' then p_quantity else -p_quantity end;

  if v_next_quantity < 0 then
    raise exception 'No se permite stock negativo.';
  end if;

  update public.stock
  set quantity = v_next_quantity,
      min_stock = coalesce(v_stock_min, v_product_min, 0),
      owner_id = v_effective_owner,
      updated_at = now()
  where product_id = p_product_id
    and owner_id = v_effective_owner;

  insert into public.inventory_movements (
    product_id,
    owner_id,
    type,
    quantity,
    reason,
    note,
    stock_before,
    stock_after,
    created_by,
    created_by_email
  )
  values (
    p_product_id,
    v_effective_owner,
    p_type,
    p_quantity,
    btrim(coalesce(p_reason, '')),
    btrim(coalesce(p_note, '')),
    v_stock_quantity,
    v_next_quantity,
    v_user_id,
    coalesce(v_user_email, '')
  );
end;
$$;

grant execute on function public.record_inventory_movement(uuid, text, integer, text, text)
to authenticated;

revoke execute on function public.record_inventory_movement(uuid, text, integer, text, text)
from anon;

-- Para asignar tu cuenta como super admin (ejecutar manualmente con tu email):
update public.profiles
set role = 'super_admin', active = true, updated_at = now()
 where email = 'abiram_sanser@hotmail.com';

-- =========================================================
-- EXTENSION V3: ventas y comisiones de vendedores (simple)
-- =========================================================

alter table public.profiles add column if not exists commission_rate numeric(8,2) not null default 10;
alter table public.profiles alter column commission_rate set default 10;

create table if not exists public.sales_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  seller_profile_id uuid not null references public.profiles(id),
  seller_name text not null default '',
  seller_email text not null default '',
  customer_name text,
  customer_phone text,
  product_id uuid references public.products(id),
  product_name text,
  quantity integer not null default 1,
  total_amount numeric(12,2) not null,
  commission_rate numeric(8,2) not null,
  commission_amount numeric(12,2) not null,
  sale_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

alter table public.sales_records add column if not exists customer_name text;
alter table public.sales_records add column if not exists customer_phone text;

create table if not exists public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  seller_profile_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null,
  payment_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

alter table public.sales_records enable row level security;
alter table public.commission_payments enable row level security;

create or replace function public.sync_sales_record_seller()
returns trigger
language plpgsql
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile
  from public.profiles
  where id = new.seller_profile_id;

  if not found then
    raise exception 'Vendedor no existe.';
  end if;

  new.seller_name := coalesce(nullif(v_profile.full_name, ''), v_profile.email, '');
  new.seller_email := coalesce(v_profile.email, '');
  new.quantity := greatest(coalesce(new.quantity, 1), 1);
  new.total_amount := round(coalesce(new.total_amount, 0)::numeric, 2);
  new.commission_rate := round(coalesce(new.commission_rate, 0)::numeric, 2);
  new.commission_amount := round(coalesce(new.commission_amount, (new.total_amount * new.commission_rate / 100))::numeric, 2);

  if new.total_amount <= 0 then
    raise exception 'Total de venta invalido.';
  end if;

  if new.commission_rate < 0 then
    raise exception 'Comision invalida.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_sales_record_seller on public.sales_records;
create trigger trg_sync_sales_record_seller
before insert or update on public.sales_records
for each row execute function public.sync_sales_record_seller();

drop policy if exists sales_records_select_role on public.sales_records;
drop policy if exists sales_records_insert_role on public.sales_records;
drop policy if exists sales_records_update_role on public.sales_records;
drop policy if exists sales_records_delete_role on public.sales_records;
drop policy if exists commission_payments_select_role on public.commission_payments;
drop policy if exists commission_payments_insert_role on public.commission_payments;
drop policy if exists commission_payments_update_role on public.commission_payments;
drop policy if exists commission_payments_delete_role on public.commission_payments;

create policy sales_records_select_role on public.sales_records
for select to authenticated
using (
  owner_id = auth.uid()
  or public.is_admin_like()
  or seller_profile_id = auth.uid()
);

create policy sales_records_insert_role on public.sales_records
for insert to authenticated
with check (
  public.current_user_role() in ('super_admin', 'admin', 'ventas')
  and (owner_id = auth.uid() or public.is_admin_like())
);

create policy sales_records_update_role on public.sales_records
for update to authenticated
using (owner_id = auth.uid() or public.is_admin_like())
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and (owner_id = auth.uid() or public.is_admin_like())
);

create policy sales_records_delete_role on public.sales_records
for delete to authenticated
using (public.is_admin_like());

create policy commission_payments_select_role on public.commission_payments
for select to authenticated
using (
  owner_id = auth.uid()
  or public.is_admin_like()
  or seller_profile_id = auth.uid()
);

create policy commission_payments_insert_role on public.commission_payments
for insert to authenticated
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and (owner_id = auth.uid() or public.is_admin_like())
);

create policy commission_payments_update_role on public.commission_payments
for update to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy commission_payments_delete_role on public.commission_payments
for delete to authenticated
using (public.is_admin_like());
