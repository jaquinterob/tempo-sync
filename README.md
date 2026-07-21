# Temporizador remoto local

PoC para controlar un temporizador desde un dispositivo y mostrarlo en otro, siempre que ambos estén conectados a la misma red Wi‑Fi.

## Requisitos

- Node.js 18 o posterior
- Ambos dispositivos en la misma red local

## Iniciar

```bash
cd /Users/jaquintero/Projects/temporizador-remoto-poc
npm install
npm start
```

El servidor muestra en la terminal las direcciones disponibles. En este equipo, al momento de la configuración, son:

- Control: `http://192.168.109.62:3000/control.html`
- Pantalla: `http://192.168.109.62:3000/display.html`
- Diseños: `http://192.168.109.62:3000/designs.html`

La IP puede cambiar al reconectar el computador a la red. En ese caso, usa la nueva dirección `Red Wi-Fi` que imprime `npm start`.

## Uso

1. Abre la URL de control en el primer dispositivo.
2. Escribe un PIN de 3 a 12 letras o números, por ejemplo `SALA1`.
3. Abre la URL de pantalla en el segundo dispositivo e ingresa el mismo PIN.
4. Desde el control, configura minutos y segundos.
5. Usa **Iniciar**, **Pausar** o **Reiniciar**. La pantalla se actualizará automáticamente.

El enlace **Abrir pantalla del temporizador** añade el PIN a la URL para entrar directamente a la misma sala.

## Desarrollo y pruebas

```bash
npm run dev
npm test
```

Las pruebas automatizadas validan dos clientes simultáneos, configuración, inicio, pausa, reinicio, reconexión y llegada a cero.

## Límites de esta PoC

- El PIN identifica la sala, pero no es una contraseña segura.
- El estado vive en memoria y se pierde al reiniciar el servidor.
- Solo funciona mientras el computador anfitrión ejecuta el servidor.
- El firewall del sistema debe permitir conexiones entrantes para Node.js.
- En HTTP, Safari no permite garantizar que la pantalla permanezca encendida. Desactiva temporalmente el bloqueo automático del iPhone.
- Para ocultar las barras de Safari, usa **Compartir > Agregar a pantalla de inicio**.
