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
