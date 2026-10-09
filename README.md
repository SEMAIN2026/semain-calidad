# Semain · Calidad

Página web de **Control de Calidad** para Semain. Se sincroniza automáticamente (solo lectura) con las páginas de [Almacén](https://semain-almacen.vercel.app) y [Shipping Notice](https://semain-shipping-notice.vercel.app) para mantener un seguimiento por item de cada PV, con indicadores visuales de tiempo usado y estado de envío.

## Stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS 4** + **shadcn/ui**
- **Prisma ORM** + **Turso** (libSQL) en producción / SQLite local en dev
- Desplegado en **Vercel**

## Funcionalidades

- **Sync automático** (solo lectura) desde Almacén y Shipping Notice vía sus APIs.
- Una fila por cada item de cada PV (no solo por PV).
- **CRUD manual**: agregar, editar y quitar items.
- **Indicador de tiempo**: barra de progreso con colores:
  - 🟢 Verde claro: enviado a tiempo
  - 🟢 Lima: enviado tarde
  - 🟡 Amarillo: 90% del tiempo usado (alerta)
  - 🔴 Rojo: tiempo agotado sin enviar
- **Botón "Actualizar fecha"** por item (para cuando la fecha de envío cambia después del sync).
- **Dashboard** con métricas clave (total, enviados a tiempo/tarde, % a tiempo, alertas).
- **Exportar CSV** de la vista filtrada.

## Reglas de color

| Estado | Color |
|---|---|
| Enviado a tiempo | Verde claro (`bg-green-100`) |
| Enviado tarde | Lima (`bg-lime-100`) |
| 90% del tiempo usado | Amarillo (`bg-yellow-100`) |
| Tiempo agotado (no enviado) | Rojo (`bg-red-100`) |
| Normal | Sin color de fila |

## Configuración local

```bash
# 1. Instalar dependencias
bun install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env con tus credenciales (o deja DATABASE_URL=file:./db/dev.db para SQLite local)

# 3. Crear la base de datos local
bun run db:push

# 4. Iniciar el servidor
bun run dev
```

## Variables de entorno

Ver `.env.example`. Resumen:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | URL de Turso (`libsql://...`) o SQLite local (`file:./db/dev.db`) |
| `TURSO_AUTH_TOKEN` | Token de la base de datos Turso (no el token de org) |
| `ALMACEN_BASE_URL` | URL de la página de Almacén |
| `ALMACEN_USERNAME` / `ALMACEN_PASSWORD` | Credenciales de Almacén (solo lectura) |
| `SHIPPING_BASE_URL` | URL de la página de Shipping Notice |
| `SHIPPING_USERNAME` / `SHIPPING_PASSWORD` | Credenciales de Shipping Notice (solo lectura) |

## Sync (solo lectura)

La página de Calidad **solo lee** datos de las otras dos páginas mediante sus APIs. Nunca modifica ningún registro en Almacén ni en Shipping Notice.

- **Sync Almacén**: obtiene todas las PVs y, por cada una, sus items. Crea una fila en Calidad por cada item.
- **Sync Shipping**: obtiene los registros de envío, matchea por número de PV o descripción de producto, y actualiza la fecha y estado de envío (`a_tiempo` / `tarde` / `no_enviado`).

## Prisma

```bash
bun run db:push      # Sincroniza el schema con la DB
bun run db:generate  # Regenera el cliente Prisma
```

## Estructura

```
src/
├── app/
│   ├── page.tsx                  # UI principal (tabla + dashboard + diálogos)
│   ├── api/
│   │   ├── calidad/items/        # CRUD de items
│   │   ├── sync/almacen/         # Sync desde Almacén
│   │   ├── sync/shipping/        # Sync desde Shipping Notice
│   │   ├── sync/status/          # Última sync de cada fuente
│   │   └── dashboard/            # Métricas para el dashboard
├── lib/
│   ├── db.ts                     # Cliente Prisma (SQLite local / Turso prod)
│   ├── almacen-client.ts         # Cliente API de Almacén (read-only)
│   ├── shipping-client.ts        # Cliente API de Shipping Notice (read-only)
│   └── time-tracking.ts          # Cálculo de tiempo usado y colores
└── prisma/
    └── schema.prisma             # Modelo de datos
```
