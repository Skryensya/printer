---
title: "Printer"
description: "Conecté una impresora térmica a internet. Le mandas un mensaje y sale en papel, en la impresora que tengo en mi escritorio."
date: 2026-06-22
tags: [bun, postgres, typescript, self-hosted, hardware]
---

# Printer

Tenía una impresora térmica de esas baratas, de recibos, juntando polvo. Y una
pregunta que no me dejaba en paz: ¿y si cualquier cosa en internet pudiera
imprimir en ella?

No para nada serio. Por lo divertido que sería. Que un build que termina escupa
un recibo. Que mi lista de compras salga en papel antes de salir de casa. Que un
amigo me deje un mensaje y aparezca, físico, en mi escritorio, sin que yo haga
nada.

Así que lo construí.

## Cómo es

Le mandas un `POST` y un segundo después algo sale impreso: un texto, una
tarjeta, una lista, un QR, una imagen. Por dentro hay tres piezas:

- La **API** recibe lo que quieras imprimir y lo guarda en una cola.
- Un **agente** chiquito vive en la máquina conectada a la impresora, escucha la
  cola por WebSocket y maneja el USB. Ese tiene que estar en casa, junto al
  cable —el USB no se deja meter en la nube.
- Un **panel** para ver la cola en vivo, componer impresiones y repartir llaves.

```bash
curl -X POST https://print-api.allison.sh/api/v1/print/text \
  -d '{"text":"hola desde internet"}'
# *zzzt* — sale en papel
```

## Lo divertido (y lo difícil, que es lo mismo)

Lo entretenido no fue ninguna pieza por separado, sino los momentos raros entre
ellas. Una impresora no tiene "deshacer". El papel es de 384 puntos de ancho,
blanco y negro, y una vez que salió, salió.

Entonces casi todo el diseño se trató de los casos feos. ¿Qué pasa si desconecto
la impresora justo después de mandar un job? (Vuelve a la cola, sin penalización.)
¿Y si tengo dos agentes —uno de producción, uno en mi laptop— peleando por el
mismo cable? (Toman turnos con un lock del kernel; nadie corta un recibo a la
mitad.) ¿Y si el agente se cae a media impresión?

Cada respuesta a "¿y si...?" era un pequeño rompecabezas con una recompensa
física: si lo resolvías bien, *sonaba* la impresora. Es de los pocos proyectos
donde el bug se ve en papel y el éxito también.

Lo armé entero, de punta a punta —la API y la cola, el panel, el protocolo del
agente, el render a ESC/POS, el deploy— sobre Bun, Postgres y un montón de ganas
de escuchar ese *zzzt*.

## Mándame algo

Esto es lo mejor: **puedes probarlo ahora**.

Entra a **[print.allison.sh](https://print.allison.sh)**, escribe un mensaje, y
va a salir impreso en la impresora que tengo en mi escritorio. Lo voy a leer en
papel.

Sé amable. O no. Igual lo voy a leer.
