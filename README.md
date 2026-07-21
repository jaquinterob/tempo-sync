# Pulpit Timer

Temporizador sincronizado para reuniones sacramentales: controla el tiempo desde un dispositivo y muéstralo en otro, en la misma red Wi‑Fi.

## Requisitos

- Node.js 18 o posterior
- Ambos dispositivos en la misma red local

## Iniciar

```bash
cd /Users/jaquintero/Projects/temporizador-remoto-poc
npm install
npm start
```

El servidor muestra en la terminal las direcciones disponibles:

- Control: `http://localhost:3000/control.html`
- Pantalla: `http://localhost:3000/display.html`

La IP de la red Wi‑Fi la imprime `npm start` (puede cambiar al reconectar).

## Uso

1. Abre `http://TU-IP:3000/` en el celular del que controla.
2. Toca **Crear sala** (entra al control con un PIN automático).
3. Toca **Copiar enlace** (o **WhatsApp**) y envíalo a quien muestra la pantalla.
4. Esa persona abre el enlace: entra directo a la sala, sin escribir el PIN.
5. Desde el control: inicia, pausa o reinicia el tiempo.

## Desarrollo y pruebas

```bash
npm run dev
npm test
```

## Notas

- El estado vive en memoria y se pierde al reiniciar el servidor.
- Solo funciona mientras el computador anfitrión ejecuta el servidor.
- El firewall del sistema debe permitir conexiones entrantes para Node.js.
- En iPhone, Safari no puede impedir de forma fiable el bloqueo automático desde una web en la red local. Durante la reunión: **Ajustes → Pantalla y brillo → Bloqueo automático → Nunca** (y vuelve a dejarlo después).
- En iPhone, Safari no admite pantalla completa desde la web. Usa **Compartir > Agregar a pantalla de inicio** y abre la app desde el ícono.
- Para ocultar las barras de Safari en Android, el botón de pantalla completa suele bastar.
