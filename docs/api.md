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
  "error": "Rate limit exceeded",
  "exceeded": "minute",
  "retry_after": 14
}
```

- `exceeded` — cuál ventana se agotó: `"minute"` o `"day"`
- `retry_after` — segundos que faltan para poder reintentar (también en el header `Retry-After`)

---

## Trabajos (Jobs)

Cada request de impresión crea un **Job** y devuelve su `id`. El Job pasa por estos estados:

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

### `POST /api/v1/print/todo`

Imprime una lista de tareas o de compras como tarjeta. Requiere el permiso `todo`.

**Body:**
```json
{
  "title": "Compras",
  "badge": "SUPER",
  "items": [
    "Pan",
    ["Leche", "2 L"],
    ["Huevos", "x12"]
  ]
}
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `items` | array | **requerido** | Lista no vacía. Cada ítem es un string (nombre) o un par `[nombre, cantidad]`. El nombre se recorta a 50 caracteres y la cantidad a 8; los ítems vacíos se descartan |
| `title` | string | — | Título de la tarjeta (opcional) |
| `badge` | string | — | Etiqueta corta en la esquina (opcional) |

Si tras descartar los ítems vacíos no queda ninguno, devuelve `400`.

**Ejemplo:**
```bash
curl -X POST https://tu-servidor/api/v1/print/todo \
  -H "X-API-Key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{"title":"Compras","items":["Pan",["Leche","2 L"],["Huevos","x12"]]}'
```

---

### `POST /api/v1/print/message`

Imprime un mensaje corto como tarjeta, con la fecha agregada automáticamente. Requiere el permiso `message` o `message_custom`.

**Body:**
```json
{
  "message": "¡Gracias por tu compra!",
  "from": "Tienda"
}
```

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `message` | string | **requerido** | Texto del mensaje |
| `from` | string | nombre de tu key | Remitente mostrado en la tarjeta. Solo se respeta si tu key tiene el permiso `message_custom`; en caso contrario se fuerza al nombre de la key |

**Ejemplo:**
```bash
curl -X POST https://tu-servidor/api/v1/print/message \
  -H "X-API-Key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{"message":"¡Gracias por tu compra!","from":"Tienda"}'
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
  "job": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "text",
    "payload": { "text": "Hola mundo", "align": "left", "bold": false, "size": 1, "invert": false },
    "status": "done",
    "source": "nombre-de-tu-key",
    "retry_count": 0,
    "error": null,
    "created_at": 1750000000,
    "updated_at": 1750000005,
    "image_url": null
  }
}
```

`image_url` es `null` salvo para Jobs de tipo `image` archivados (URL pública del original).

`created_at` y `updated_at` son Unix timestamps en segundos.

---

## Respuestas de éxito

Todos los endpoints de impresión devuelven `202 Accepted` al encolar correctamente, con un header `Location` apuntando al recurso del Job:

```
Location: /api/v1/jobs/550e8400-e29b-41d4-a716-446655440000
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Errores

El cuerpo de error siempre lleva un campo `error` con un mensaje legible (nunca un código de máquina — el status HTTP es la señal procesable):

```json
{
  "error": "descripción del error"
}
```

| Código | Causa | Campos extra |
|---|---|---|
| `400` | Body inválido o campo requerido faltante | — |
| `401` | API key ausente, inválida, revocada o expirada | — |
| `403` | La key no tiene permiso para el tipo solicitado | `type` (tipo intentado), `allowed` (tipos permitidos, o `null` si no hay restricción) |
| `404` | Job no encontrado (o pertenece a otra key) | — |
| `429` | Rate limit excedido | `exceeded` (`"minute"` o `"day"`), `retry_after` (segundos) |

Ejemplo de `403`:

```json
{
  "error": "Job type not permitted",
  "type": "image",
  "allowed": ["text"]
}
```
