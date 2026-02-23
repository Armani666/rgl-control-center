# RGL Control Center (MVP)

MVP en Angular (standalone + routing + SCSS) para administrar productos e inventario de **Rose Gold Lexury** con **Supabase (Postgres)**.

## Rutas

- `/products`
- `/products/new`
- `/products/:id`
- `/stock`
- `/stock/move/:productId`

## Conectar Supabase

1. Crea un proyecto en Supabase (free tier).
2. En Supabase abre **SQL Editor** y ejecuta `supabase/schema.sql`.
3. Copia:
   - `Project URL`
   - `anon public key`
4. Pega los valores en:
   - `src/environments/environment.ts`
   - `src/environments/environment.prod.ts` (opcional al inicio, puedes repetir los mismos valores)
5. Inicia la app:

```bash
npm install
npm install @supabase/supabase-js
npm run start
```

## Login y seguridad (RLS + Auth)

1. En Supabase ve a `Authentication` -> `Providers` y habilita `Email` (email/password).
2. En la app entra a `/auth/login` y crea tu primera cuenta (o créala desde Supabase Auth).
3. Vuelve a Supabase `SQL Editor` y ejecuta `supabase/secure-auth-rls.sql`.
4. Cierra sesión / inicia sesión nuevamente y prueba el flujo.

Qué hace `secure-auth-rls.sql`:
- Agrega `owner_id` a `products`, `stock`, `inventory_movements`
- Restringe datos por usuario autenticado (`authenticated`)
- Endurece la RPC de inventario para operar solo sobre datos del usuario actual

## Deploy (Vercel / Netlify)

### Opción A: Vercel

1. Sube este repo a GitHub.
2. Importa el proyecto en Vercel.
3. Vercel detectará `vercel.json` y usará:
   - build: `npm run build`
   - output: `dist/rgl-control-center/browser`
4. Antes de deploy, confirma que `src/environments/environment.prod.ts` tenga tu `url` + `anonKey` de Supabase.

### Opción B: Netlify

1. Conecta el repo en Netlify.
2. Netlify leerá `netlify.toml`:
   - build: `npm run build`
   - publish: `dist/rgl-control-center/browser`
3. El redirect SPA (`/* -> /index.html`) ya queda configurado.
4. Antes de deploy, confirma que `src/environments/environment.prod.ts` tenga tu `url` + `anonKey` de Supabase.

### Variables / claves (importante)

- La `anon public key` de Supabase se puede usar en frontend (es pública por diseño).
- No pongas la `service_role` key en Angular.
- Si quieres evitar commitear valores reales, podemos hacer una segunda iteración con configuración runtime (`app-config.json`) para deploys.

## Notas de seguridad (MVP)

- `supabase/schema.sql` deja políticas RLS abiertas para arranque rápido.
- `supabase/secure-auth-rls.sql` es el paso recomendado antes de publicar.
- El control de stock negativo se hace en la función SQL `record_inventory_movement(...)` con transacción en Postgres.

## Probar el flujo (MVP)

1. Entra a `/products/new` y crea un producto (SKU, nombre, precio, stock mínimo).
2. Ve a `/stock` y entra a **Registrar movimiento** para ese producto.
3. Registra una **Entrada (IN)** con cantidad mayor a 0.
4. Verifica que el stock suba y que el movimiento aparezca en el historial.
5. Intenta una **Salida (OUT)** superior al stock actual para confirmar que se bloquea el stock negativo.
