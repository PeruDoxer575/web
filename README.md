# Peru Doxer Sitio Web

Sitio web listo para evolucionar a produccion con:

- Catalogo con varias fotos por servicio
- Subida real de imagenes desde el panel
- Pedidos por WhatsApp
- Comprobante de pago antes de enviar el pedido
- Historial de pedidos en el panel
- Cupones de descuento
- Notificacion opcional a Telegram
- Respaldo por correo si SMTP esta activo
- Reseñas administrables
- Login admin con usuario y clave
- Base de datos local en `data/store.sqlite`
- Carpeta `uploads/` para imagenes subidas
- Cloudinary opcional para Railway y hosting

## Como probarlo en tu PC

1. Instala Node.js LTS desde [https://nodejs.org/](https://nodejs.org/).
2. Abre una terminal en esta carpeta.
3. Ejecuta `npm install`.
4. Ejecuta `npm start`.
5. Abre `http://localhost:3000`.

## Login del panel

- Usuario: el valor de `ADMIN_USERNAME` en `.env`
- Clave: el valor de `ADMIN_PASSWORD` en `.env`

## Panel admin

Desde el panel puedes:

- cambiar logo, WhatsApp, correo y nombre del negocio
- agregar servicios con precio en soles
- agregar varios precios para un mismo servicio
- subir varias fotos por servicio
- editar o eliminar servicios
- agregar, editar y eliminar reseñas
- crear cupones simples por porcentaje o monto fijo
- revisar el historial de pedidos y comprobantes
- recibir apoyo de un bot admin privado en Telegram para agregar o editar productos

## Correo

En Railway te conviene usar `Resend` por API:

- `RESEND_API_KEY`
- `RESEND_FROM`

El proyecto usa Resend primero y SMTP como respaldo.

Si quieres notificacion a Telegram agrega:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_CHAT_IDS`

El bot admin usa la misma base de datos de la web, así que lo que cambies ahí también aparece en la página.
Cuando uses `/agregar`, en el paso de imágenes puedes enviar la foto directamente por Telegram y luego escribir `listo`.

Comandos base del bot:

- `/productos`
- `/agregar`
- `/cupones`
- `/pedidos`
- `/resumen`
- `/buscar nombre`
- `/ajustes`
- `/precio ID nuevo_precio`
- `/estado ID Disponible|Nuevo|Oferta|Agotado`
- `/descripcion ID texto`
- `/eliminar ID`

Además del texto, ahora el bot tiene menú con botones para:

- productos
- crear cupones
- ver pedidos
- editar precio, estado, descripción y fotos
- editar categoría y precios adicionales
- volver al menú con botones
- buscar productos por nombre
- confirmar borrado antes de eliminar
- abrir comprobantes desde botones en pedidos
- marcar pedidos como pendiente o atendido
- cambiar WhatsApp, correo, titular Plin y lema desde Telegram
- editar valor y tipo de cupones desde botones
- recibir alerta de pedido con botón `Atender ahora`

En edición de fotos:

- puedes agregar fotos nuevas
- o reemplazar todas las fotos de un producto
- envías la imagen directo por Telegram y luego escribes `listo`

Para pruebas locales, si quieres, tambien puedes usar Gmail con App Password en `SMTP_PASS`.

## Railway

Railway te da SSL automaticamente cuando conectes tu dominio.

Pasos recomendados:

1. Sube el proyecto a GitHub.
2. Crea un proyecto en Railway desde ese repositorio.
3. Configura las variables de entorno:
   `ADMIN_USERNAME`
   `ADMIN_PASSWORD`
   `SESSION_SECRET`
   `RESEND_API_KEY`
   `RESEND_FROM`
   `TELEGRAM_BOT_TOKEN`
   `TELEGRAM_CHAT_ID`
   `TELEGRAM_ADMIN_CHAT_IDS`
   `SMTP_HOST`
   `SMTP_PORT`
   `SMTP_USER`
   `SMTP_PASS`
   `SMTP_FROM`
   `CLOUDINARY_CLOUD_NAME`
   `CLOUDINARY_API_KEY`
   `CLOUDINARY_API_SECRET`
   `CLOUDINARY_FOLDER`
4. Despliega.
5. En Railway agrega tu dominio personalizado.
6. Railway emitira el SSL automaticamente.

## Cloudinary

Si configuras Cloudinary:

- las imagenes subidas desde el panel se guardaran fuera de Railway
- no perderas fotos en cada redeploy
- las URLs quedaran listas para produccion

Si no configuras Cloudinary:

- en tu PC seguira usando `uploads/`
- en Railway las imagenes pueden perderse si el contenedor cambia

## Importante

- `data/` y `uploads/` son locales. En Railway, si reinicias o redespliegas, esos archivos pueden perderse.
- Para produccion real despues te conviene migrar a almacenamiento externo:
  Cloudinary, S3 o Supabase Storage para imagenes
  PostgreSQL o MySQL para la base de datos
