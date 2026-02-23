create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  name text not null,
  category text,
  description text not null default '',
  price numeric(12, 2) not null default 0 check (price >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists products_sku_key on public.products (sku);

create table if not exists public.stock (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null check (type in ('IN', 'OUT')),
  quantity integer not null check (quantity > 0),
  reason text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_product_id_created_at_idx
on public.inventory_movements (product_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

drop trigger if exists stock_touch_updated_at on public.stock;
create trigger stock_touch_updated_at
before update on public.stock
for each row execute function public.touch_updated_at();

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
  v_product_min integer;
  v_stock_quantity integer;
  v_stock_min integer;
  v_next_quantity integer;
begin
  if p_type not in ('IN', 'OUT') then
    raise exception 'Tipo de movimiento inválido.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.';
  end if;

  select min_stock
  into v_product_min
  from public.products
  where id = p_product_id;

  if not found then
    raise exception 'El producto no existe.';
  end if;

  select quantity, min_stock
  into v_stock_quantity, v_stock_min
  from public.stock
  where product_id = p_product_id
  for update;

  if not found then
    insert into public.stock (product_id, quantity, min_stock)
    values (p_product_id, 0, coalesce(v_product_min, 0));
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
      updated_at = now()
  where product_id = p_product_id;

  insert into public.inventory_movements (product_id, type, quantity, reason, note)
  values (p_product_id, p_type, p_quantity, btrim(coalesce(p_reason, '')), btrim(coalesce(p_note, '')));
end;
$$;

grant execute on function public.record_inventory_movement(uuid, text, integer, text, text)
to anon, authenticated;

alter table public.products enable row level security;
alter table public.stock enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists products_all on public.products;
create policy products_all on public.products
for all to anon, authenticated
using (true)
with check (true);

drop policy if exists stock_all on public.stock;
create policy stock_all on public.stock
for all to anon, authenticated
using (true)
with check (true);

drop policy if exists inventory_movements_all on public.inventory_movements;
create policy inventory_movements_all on public.inventory_movements
for all to anon, authenticated
using (true)
with check (true);
