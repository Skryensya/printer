# Printer API — Documentación para consumidores

La API recibe trabajos de impresión vía HTTP y los encola para ser ejecutados por la impresora térmica conectada al servidor. Todos los endpoints de impresión son asíncronos: la respuesta confirma que el trabajo fue recibido, no que ya fue impreso.

## Autenticación

Todos los endpoints de impresión requieren una API key. Incluirla en cualquiera de estas dos formas:

```
X-API-Key: tu-api-key
```
```
Authorization: Bearer tu-api-key
```

Si la key es inválida, revocada o expirada, la API devuelve `401 Unauthorized`.

---

## Rate limiting

Cada key puede tener un límite por minuto y/o por día configurado por el administrador. Todas las respuestas autenticadas incluyen headers con el estado actual de tu cuota:

| Header | Descripción |
|---|---|
| `X-RateLimit-Limit-Minute` | Máximo de requests por minuto (ausente si ilimitado) |
| `X-RateLimit-Remaining-Minute` | Requests disponibles en el minuto actual |
| `X-RateLimit-Reset-Minute` | Unix timestamp de cuándo se libera el próximo slot |
| `X-RateLimit-Limit-Day` | Máximo de requests por día UTC (ausente si ilimitado) |
| `X-RateLimit-Remaining-Day` | Requests disponibles hoy |
| `X-RateLimit-Reset-Day` | Unix timestamp de la próxima medianoche UTC |

Cuando se supera un límite, la API responde con `429 Too Many Requests`:

```json
{
  "ok": false,
  "error": "rate_limit_exceeded",
  "limit": "minute",
  "retry_after": 14
}
```

- `limit` — cuál ventana se agotó: `"minute"` o `"day"`
- `retry_after` — segundos que faltan para poder reintentar (también en el header `Retry-After`)

---

## Trabajos (Jobs)

Cada request de impresión crea un **Job** y devuelve su `jobId`. El Job pasa por estos estados:

```
pending → printing → done
                   ↘ failed
         cancelled
```

Puedes consultar el estado de un Job con tu misma API key.

---

## Endpoints de impresión

### `POST /api/v1/print/text`

Imprime texto con formato.

**Body:**
```json
{
  "text": "Hola mundo",
  "align": "left",
  "bold": false,
  "size": 1,
  "invert": false
}
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `text` | string | **requerido** | Texto a imprimir. Soporta `\n` para saltos de línea. Máximo 32 caracteres por línea |
| `align` | `"left"` `"center"` `"right"` | `"left"` | Alineación |
| `bold` | boolean | `false` | Negrita |
| `size` | integer 1–4 | `1` | Tamaño de fuente (1 = normal, 2 = doble, etc.) |
| `invert` | boolean | `false` | Texto blanco sobre fondo negro |

**Ejemplo:**
```bash
curl -X POST https://tu-servidor/api/v1/print/text \
  -H "X-API-Key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{"text":"PEDIDO #1042\nMesa 5","align":"center","bold":true}'
```

---

### `POST /api/v1/print/ticket`

Imprime un ticket de tarea con bordes, prioridad, estado y campos opcionales.

**Body:**
```json
{
  "id": "042",
  "title": "Fix auth bug on Safari",
  "priority": "HIGH",
  "status": "TODO",
  "assignee": "ana",
  "due": "2026-06-30",
  "tags": ["auth", "bug"],
  "style": "thin"
}
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `id` | string | **requerido** | Identificador del ticket |
| `title` | string | **requerido** | Título (se ajusta automáticamente al ancho de la hoja) |
| `priority` | `"LOW"` `"MEDIUM"` `"HIGH"` `"CRITICAL"` | **requerido** | Prioridad |
| `status` | `"TODO"` `"IN PROGRESS"` `"DONE"` `"BLOCKED"` | **requerido** | Estado |
| `assignee` | string | — | Responsable (opcional) |
| `due` | string | — | Fecha de vencimiento en formato `YYYY-MM-DD` (opcional) |
| `tags` | string[] | — | Etiquetas (opcional) |
| `style` | `"ascii"` `"thin"` `"double"` `"block"` `"shade"` `"stars"` | `"thin"` | Estilo de borde |

**Ejemplo:**
```bash
curl -X POST https://tu-servidor/api/v1/print/ticket \
  -H "X-API-Key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "042",
    "title": "Fix auth bug on Safari",
    "priority": "HIGH",
    "status": "TODO",
    "assignee": "ana",
    "due": "2026-06-30",
    "tags": ["auth", "bug"]
  }'
```

---

### `POST /api/v1/print/qr`

Imprime un código QR centrado en la hoja.

**Body:**
```json
{
  "text": "https://ejemplo.com/pedido/1042",
  "size": 8,
  "errorLevel": "M"
}
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `text` | string | **requerido** | Contenido del QR (URL, texto, etc.) |
| `size` | integer 1–16 | `8` | Tamaño de módulo en puntos |
| `errorLevel` | `"L"` `"M"` `"Q"` `"H"` | `"M"` | Nivel de corrección de errores |

**Ejemplo:**
```bash
curl -X POST https://tu-servidor/api/v1/print/qr \
  -H "X-API-Key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{"text":"https://ejemplo.com/pedido/1042"}'
```

---

### `POST /api/v1/print/barcode`

Imprime un código de barras Code 128.

**Body:**
```json
{
  "data": "PEDIDO-1042",
  "height": 80
}
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `data` | string | **requerido** | Datos a codificar |
| `height` | integer 1–255 | `80` | Altura de las barras en puntos |

**Ejemplo:**
```bash
curl -X POST https://tu-servidor/api/v1/print/barcode \
  -H "X-API-Key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{"data":"PEDIDO-1042","height":80}'
```

---

### `POST /api/v1/print/image`

Imprime una imagen en escala de grises, escalada a 384 px de ancho y convertida a 1 bit con dithering Floyd-Steinberg.

**Body:**
```json
{
  "image": "<base64>",
  "mediaType": "image/png"
}
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `image` | string | **requerido** | Imagen codificada en base64 |
| `mediaType` | string | — | MIME type de la imagen (ej. `"image/png"`, `"image/jpeg"`) |

**Ejemplo con curl:**
```bash
curl -X POST https://tu-servidor/api/v1/print/image \
  -H "X-API-Key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d "{\"image\":\"$(base64 -i logo.png | tr -d '\n')\"}"
```

---

## Consultar un Job

### `GET /api/v1/jobs/:id`

Devuelve el estado actual de un Job creado con tu key.

**Ejemplo:**
```bash
curl https://tu-servidor/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000 \
  -H "X-API-Key: tu-api-key"
```

**Respuesta:**
```json
{
  "ok": true,
  "job": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "text",
    "payload": { "text": "Hola mundo", "align": "left", "bold": false, "size": 1, "invert": false },
    "status": "done",
    "source": "nombre-de-tu-key",
    "retry_count": 0,
    "error": null,
    "created_at": 1750000000,
    "updated_at": 1750000005
  }
}
```

`created_at` y `updated_at` son Unix timestamps en segundos.

---

## Respuestas de éxito

Todos los endpoints de impresión devuelven `202 Accepted` al encolar correctamente:

```json
{
  "ok": true,
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Errores

Todos los errores siguen el mismo formato:

```json
{
  "ok": false,
  "error": "descripción del error"
}
```

| Código | Causa |
|---|---|
| `400` | Body inválido o campo requerido faltante |
| `401` | API key ausente, inválida, revocada o expirada |
| `429` | Rate limit excedido |
| `404` | Job no encontrado |
