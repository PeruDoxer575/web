const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const initSqlJs = require("sql.js");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");
require("dotenv").config();

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cambiar-esta-clave";
const SESSION_SECRET = process.env.SESSION_SECRET || "peru-doxer-session-secret";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const TELEGRAM_ADMIN_CHAT_IDS = String(process.env.TELEGRAM_ADMIN_CHAT_IDS || TELEGRAM_CHAT_ID || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || "perudoxer";
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "store.sqlite");
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, "uploads");

const defaultStore = {
  storeName: "PERUDOXER",
  whatsappNumber: "51988899790",
  logoUrl: "assets/logo.jpeg",
  storeHandle: "@serviciosdoxer",
  storeEmail: "perudoxer@gmail.com",
  storeCurrency: "S/",
  storeLanguage: "es",
  paymentHolder: "Kimberly Cunyas",
  paymentQrUrl: "",
  services: [
    {
      id: crypto.randomUUID(),
      name: "Servicio Basico",
      category: "General",
      status: "Disponible",
      price: "S/ 25",
      priceOptions: ["1 mes - S/ 25", "3 meses - S/ 60"],
      description: "Ideal para clientes que quieren una solucion rapida y clara.",
      images: ["assets/servicio1.jpeg"]
    }
  ],
  coupons: [
    {
      id: crypto.randomUUID(),
      code: "BIENVENIDA10",
      type: "percent",
      value: 10,
      active: 1
    }
  ],
  orders: [],
  testimonials: [
    {
      id: crypto.randomUUID(),
      author: "Cliente verificado",
      role: "Lima, Peru",
      quote: "Atencion directa, rapida y clara. Todo el proceso fue ordenado por WhatsApp."
    },
    {
      id: crypto.randomUUID(),
      author: "Cliente frecuente",
      role: "Arequipa, Peru",
      quote: "La presentacion del servicio transmite confianza y la coordinacion fue sencilla."
    }
  ]
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024
  }
});

const telegramBotSessions = new Map();

function startTelegramAdminBot({ db, persistDatabase, cloudinaryEnabled }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_IDS.length) {
    return;
  }

  let offset = 0;

  async function poll() {
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=25&offset=${offset}`);
      const data = await response.json();

      if (!data.ok || !Array.isArray(data.result)) {
        throw new Error("telegram_updates_failed");
      }

      for (const update of data.result) {
        offset = update.update_id + 1;
        await handleTelegramAdminUpdate(update, { db, persistDatabase, cloudinaryEnabled });
      }
    } catch (error) {
      console.error("Bot de Telegram admin detenido momentáneamente.", error.message);
    } finally {
      setTimeout(poll, 1200);
    }
  }

  poll();
}

async function handleTelegramAdminUpdate(update, context) {
  if (update.callback_query) {
    await handleTelegramAdminCallback(update.callback_query, context);
    return;
  }

  const message = update.message;
  if (!message || !message.chat?.id) {
    return;
  }

  const chatId = String(message.chat.id);
  if (!TELEGRAM_ADMIN_CHAT_IDS.includes(chatId)) {
    await sendTelegramBotMessage(chatId, "Este bot es privado.");
    return;
  }

  const text = String(message.text || "").trim();
  const session = telegramBotSessions.get(chatId);

  if (text.startsWith("/")) {
    telegramBotSessions.delete(chatId);
    await handleTelegramAdminCommand(chatId, text, context);
    return;
  }

  if (session?.mode === "add_service") {
    await continueAddServiceWizard(chatId, message, session, context);
    return;
  }

  if (session?.mode === "add_coupon") {
    await continueAddCouponWizard(chatId, message, session, context);
    return;
  }

  if (session?.mode === "edit_service_price") {
    await continueEditServicePrice(chatId, message, session, context);
    return;
  }

  if (session?.mode === "edit_service_description") {
    await continueEditServiceDescription(chatId, message, session, context);
    return;
  }

  if (session?.mode === "edit_service_images") {
    await continueEditServiceImages(chatId, message, session, context);
  }
}

async function handleTelegramAdminCommand(chatId, text, { db, persistDatabase }) {
  const [command, ...rest] = text.split(" ");
  const args = rest.join(" ").trim();

  if (command === "/start" || command === "/menu" || command === "/ayuda") {
    await sendTelegramBotMessage(
      chatId,
      "Bot admin de PERUDOXER",
      {
        inline_keyboard: [
          [{ text: "Productos", callback_data: "menu_products" }, { text: "Agregar producto", callback_data: "menu_add_service" }],
          [{ text: "Cupones", callback_data: "menu_coupons" }, { text: "Pedidos", callback_data: "menu_orders" }],
          [{ text: "Resumen", callback_data: "menu_summary" }]
        ]
      }
    );
    return;
  }

  if (command === "/productos") {
    await sendTelegramProductsMenu(chatId, db);
    return;
  }

  if (command === "/agregar") {
    telegramBotSessions.set(chatId, {
      mode: "add_service",
      step: "name",
      data: {}
    });
    await sendTelegramBotMessage(chatId, "Vamos a agregar un producto.\n\n1. Envíame el nombre del servicio.");
    return;
  }

  if (command === "/cupones") {
    await sendTelegramCouponsMenu(chatId, db);
    return;
  }

  if (command === "/pedidos") {
    await sendTelegramOrders(chatId, db);
    return;
  }

  if (command === "/resumen") {
    await sendTelegramSummary(chatId, db);
    return;
  }

  if (command === "/precio") {
    const [rawId, ...priceParts] = args.split(" ").filter(Boolean);
    const nextPrice = priceParts.join(" ").trim();
    const service = findServiceByTelegramId(db, rawId);

    if (!service || !nextPrice) {
      await sendTelegramBotMessage(chatId, "Uso: /precio ID nuevo_precio");
      return;
    }

    db.run("UPDATE services SET price = ? WHERE id = ?", [nextPrice, service.id]);
    persistDatabase(db);
    await sendTelegramBotMessage(chatId, `Precio actualizado para ${service.name}: ${nextPrice}`);
    return;
  }

  if (command === "/estado") {
    const [rawId, nextStatus] = args.split(" ").filter(Boolean);
    const validStatuses = ["Disponible", "Nuevo", "Oferta", "Agotado"];
    const service = findServiceByTelegramId(db, rawId);

    if (!service || !validStatuses.includes(nextStatus)) {
      await sendTelegramBotMessage(chatId, "Uso: /estado ID Disponible|Nuevo|Oferta|Agotado");
      return;
    }

    db.run("UPDATE services SET status = ? WHERE id = ?", [nextStatus, service.id]);
    persistDatabase(db);
    await sendTelegramBotMessage(chatId, `Estado actualizado para ${service.name}: ${nextStatus}`);
    return;
  }

  if (command === "/descripcion") {
    const [rawId, ...descriptionParts] = args.split(" ");
    const description = descriptionParts.join(" ").trim();
    const service = findServiceByTelegramId(db, rawId);

    if (!service || !description) {
      await sendTelegramBotMessage(chatId, "Uso: /descripcion ID texto");
      return;
    }

    db.run("UPDATE services SET description = ? WHERE id = ?", [description, service.id]);
    persistDatabase(db);
    await sendTelegramBotMessage(chatId, `Descripcion actualizada para ${service.name}.`);
    return;
  }

  if (command === "/eliminar") {
    const service = findServiceByTelegramId(db, args);
    if (!service) {
      await sendTelegramBotMessage(chatId, "Uso: /eliminar ID");
      return;
    }

    db.run("DELETE FROM services WHERE id = ?", [service.id]);
    persistDatabase(db);
    await sendTelegramBotMessage(chatId, `Servicio eliminado: ${service.name}`);
    return;
  }

  await sendTelegramBotMessage(chatId, "No entendí ese comando. Usa /ayuda");
}

async function continueAddServiceWizard(chatId, message, session, { db, persistDatabase, cloudinaryEnabled }) {
  const value = String(message.text || "").trim();
  const data = session.data;

  if (session.step === "name") {
    data.name = value;
    session.step = "category";
    await sendTelegramBotMessage(chatId, "2. Categoria del servicio:");
    return;
  }

  if (session.step === "category") {
    data.category = value || "General";
    session.step = "status";
    await sendTelegramBotMessage(chatId, "3. Estado del servicio: Disponible, Nuevo, Oferta o Agotado");
    return;
  }

  if (session.step === "status") {
    data.status = ["Disponible", "Nuevo", "Oferta", "Agotado"].includes(value) ? value : "Disponible";
    session.step = "price";
    await sendTelegramBotMessage(chatId, "4. Precio principal. Ejemplo: S/ 25");
    return;
  }

  if (session.step === "price") {
    data.price = value;
    session.step = "priceOptions";
    await sendTelegramBotMessage(chatId, "5. Precios adicionales opcionales en una sola línea separados por |. Si no quieres, responde: no");
    return;
  }

  if (session.step === "priceOptions") {
    data.priceOptions = value.toLowerCase() === "no"
      ? []
      : value.split("|").map((item) => item.trim()).filter(Boolean);
    session.step = "description";
    await sendTelegramBotMessage(chatId, "6. Descripción del servicio:");
    return;
  }

  if (session.step === "description") {
    data.description = value;
    session.step = "images";
    data.images = [];
    await sendTelegramBotMessage(chatId, "7. Envíame una o varias fotos del producto por aquí mismo. Cuando termines, escribe: listo. Si no quieres agregar imágenes ahora, responde: no");
    return;
  }

  if (session.step === "images") {
    if (message.photo?.length || message.document) {
      const uploadedImage = await storeTelegramMedia(message, cloudinaryEnabled);
      if (!uploadedImage) {
        await sendTelegramBotMessage(chatId, "No pude subir esa imagen. Intenta otra vez o escribe listo.");
        return;
      }

      data.images = [...(data.images || []), uploadedImage.url];
      await sendTelegramBotMessage(chatId, `Imagen agregada (${data.images.length}). Envía otra o escribe listo.`);
      return;
    }

    if (value.toLowerCase() === "no") {
      data.images = [];
    } else if (value.toLowerCase() !== "listo") {
      await sendTelegramBotMessage(chatId, "Envíame una foto, o escribe listo para guardar, o no para seguir sin imágenes.");
      return;
    }

    db.run(
      "INSERT INTO services (id, name, category, status, price, priceOptionsJson, description, imagesJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        crypto.randomUUID(),
        data.name,
        data.category || "General",
        data.status || "Disponible",
        data.price,
        JSON.stringify(data.priceOptions || []),
        data.description || "",
        JSON.stringify(data.images || [])
      ]
    );
    persistDatabase(db);
    telegramBotSessions.delete(chatId);
    await sendTelegramBotMessage(chatId, `Producto agregado: ${data.name}`);
  }
}

async function continueAddCouponWizard(chatId, message, session, { db, persistDatabase }) {
  const value = String(message.text || "").trim();
  const data = session.data;

  if (session.step === "code") {
    data.code = value.toUpperCase();
    session.step = "type";
    await sendTelegramBotMessage(chatId, "2. Tipo de cupón:", {
      inline_keyboard: [[
        { text: "Porcentaje", callback_data: "coupon_type:percent" },
        { text: "Monto fijo", callback_data: "coupon_type:fixed" }
      ]]
    });
    return;
  }

  if (session.step === "value") {
    const numericValue = Number(value.replace(",", "."));
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      await sendTelegramBotMessage(chatId, "Envíame un valor válido para el cupón.");
      return;
    }

    data.value = numericValue;
    session.step = "active";
    await sendTelegramBotMessage(chatId, "3. ¿El cupón estará activo?", {
      inline_keyboard: [[
        { text: "Sí", callback_data: "coupon_active:1" },
        { text: "No", callback_data: "coupon_active:0" }
      ]]
    });
    return;
  }

  if (session.step === "done") {
    db.run(
      "INSERT INTO coupons (id, code, type, value, active) VALUES (?, ?, ?, ?, ?)",
      [crypto.randomUUID(), data.code, data.type || "percent", data.value || 0, data.active ? 1 : 0]
    );
    persistDatabase(db);
    telegramBotSessions.delete(chatId);
    await sendTelegramBotMessage(chatId, `Cupón creado: ${data.code}`);
  }
}

async function continueEditServicePrice(chatId, message, session, { db, persistDatabase }) {
  const nextPrice = String(message.text || "").trim();
  if (!nextPrice) {
    await sendTelegramBotMessage(chatId, "Envíame un precio válido.");
    return;
  }

  db.run("UPDATE services SET price = ? WHERE id = ?", [nextPrice, session.serviceId]);
  persistDatabase(db);
  telegramBotSessions.delete(chatId);
  await sendTelegramBotMessage(chatId, "Precio actualizado.");
}

async function continueEditServiceDescription(chatId, message, session, { db, persistDatabase }) {
  const nextDescription = String(message.text || "").trim();
  if (!nextDescription) {
    await sendTelegramBotMessage(chatId, "Envíame una descripción válida.");
    return;
  }

  db.run("UPDATE services SET description = ? WHERE id = ?", [nextDescription, session.serviceId]);
  persistDatabase(db);
  telegramBotSessions.delete(chatId);
  await sendTelegramBotMessage(chatId, "Descripción actualizada.");
}

async function continueEditServiceImages(chatId, message, session, { db, persistDatabase, cloudinaryEnabled }) {
  const value = String(message.text || "").trim().toLowerCase();
  const store = readStore(db);
  const service = store.services.find((item) => item.id === session.serviceId);

  if (!service) {
    telegramBotSessions.delete(chatId);
    await sendTelegramBotMessage(chatId, "No encontré ese producto.");
    return;
  }

  if (message.photo?.length || message.document) {
    const uploadedImage = await storeTelegramMedia(message, cloudinaryEnabled);
    if (!uploadedImage) {
      await sendTelegramBotMessage(chatId, "No pude subir esa imagen. Intenta otra vez o escribe listo.");
      return;
    }

    const currentImages = Array.isArray(session.images) ? session.images : [...(service.images || [])];
    if (session.imageMode === "replace" && !session.hasReplacedOnce) {
      session.images = [uploadedImage.url];
      session.hasReplacedOnce = true;
    } else {
      session.images = [...currentImages, uploadedImage.url];
    }

    await sendTelegramBotMessage(chatId, `Imagen agregada (${session.images.length}). Envía otra o escribe listo.`);
    return;
  }

  if (value === "cancelar") {
    telegramBotSessions.delete(chatId);
    await sendTelegramBotMessage(chatId, "Edición de fotos cancelada.");
    return;
  }

  if (value !== "listo") {
    await sendTelegramBotMessage(chatId, "Envíame una foto, escribe listo para guardar o cancelar para salir.");
    return;
  }

  const finalImages = Array.isArray(session.images) ? session.images : [...(service.images || [])];
  db.run("UPDATE services SET imagesJson = ? WHERE id = ?", [JSON.stringify(finalImages), service.id]);
  persistDatabase(db);
  telegramBotSessions.delete(chatId);
  await sendTelegramBotMessage(chatId, `Fotos actualizadas para ${service.name}.`);
}

function findServiceByTelegramId(db, rawId) {
  const value = String(rawId || "").trim();
  if (!value) {
    return null;
  }

  const store = readStore(db);
  return store.services.find((service) => service.id === value || service.id.startsWith(value));
}

async function handleTelegramAdminCallback(callbackQuery, { db, persistDatabase }) {
  const chatId = String(callbackQuery.message?.chat?.id || callbackQuery.from?.id || "");
  const callbackId = callbackQuery.id;
  const data = String(callbackQuery.data || "");

  if (!chatId || !TELEGRAM_ADMIN_CHAT_IDS.includes(chatId)) {
    await answerTelegramCallback(callbackId, "No autorizado");
    return;
  }

  if (data === "menu_products") {
    await answerTelegramCallback(callbackId, "Productos");
    await sendTelegramProductsMenu(chatId, db);
    return;
  }

  if (data === "menu_add_service") {
    telegramBotSessions.set(chatId, { mode: "add_service", step: "name", data: {} });
    await answerTelegramCallback(callbackId, "Agregar producto");
    await sendTelegramBotMessage(chatId, "Vamos a agregar un producto.\n\n1. Envíame el nombre del servicio.");
    return;
  }

  if (data === "menu_coupons") {
    await answerTelegramCallback(callbackId, "Cupones");
    await sendTelegramCouponsMenu(chatId, db);
    return;
  }

  if (data === "menu_orders") {
    await answerTelegramCallback(callbackId, "Pedidos");
    await sendTelegramOrders(chatId, db);
    return;
  }

  if (data === "menu_summary") {
    await answerTelegramCallback(callbackId, "Resumen");
    await sendTelegramSummary(chatId, db);
    return;
  }

  if (data === "menu_back") {
    await answerTelegramCallback(callbackId, "Menú");
    await handleTelegramAdminCommand(chatId, "/start", { db, persistDatabase });
    return;
  }

  if (data === "noop") {
    await answerTelegramCallback(callbackId, "OK");
    return;
  }

  if (data === "coupon_add") {
    telegramBotSessions.set(chatId, { mode: "add_coupon", step: "code", data: {} });
    await answerTelegramCallback(callbackId, "Nuevo cupón");
    await sendTelegramBotMessage(chatId, "Vamos a crear un cupón.\n\n1. Envíame el código. Ejemplo: BIENVENIDA10");
    return;
  }

  if (data.startsWith("coupon_type:")) {
    const session = telegramBotSessions.get(chatId);
    if (session?.mode === "add_coupon") {
      session.data.type = data.split(":")[1] || "percent";
      session.step = "value";
      await answerTelegramCallback(callbackId, "Tipo guardado");
      await sendTelegramBotMessage(chatId, "Ahora envíame el valor. Ejemplo: 10");
      return;
    }
  }

  if (data.startsWith("coupon_active:")) {
    const session = telegramBotSessions.get(chatId);
    if (session?.mode === "add_coupon") {
      session.data.active = data.endsWith(":1");
      session.step = "done";
      await answerTelegramCallback(callbackId, "Estado guardado");
      await continueAddCouponWizard(chatId, { text: "ok" }, session, { db, persistDatabase });
      return;
    }
  }

  if (data.startsWith("coupon_delete:")) {
    const couponId = data.split(":")[1];
    db.run("DELETE FROM coupons WHERE id = ?", [couponId]);
    persistDatabase(db);
    await answerTelegramCallback(callbackId, "Cupón eliminado");
    await sendTelegramCouponsMenu(chatId, db);
    return;
  }

  if (data.startsWith("coupon_toggle:")) {
    const couponId = data.split(":")[1];
    const store = readStore(db);
    const coupon = store.coupons.find((item) => item.id === couponId);
    if (coupon) {
      db.run("UPDATE coupons SET active = ? WHERE id = ?", [coupon.active ? 0 : 1, coupon.id]);
      persistDatabase(db);
    }
    await answerTelegramCallback(callbackId, "Cupón actualizado");
    await sendTelegramCouponsMenu(chatId, db);
    return;
  }

  if (data.startsWith("product_view:")) {
    const service = findServiceByTelegramId(db, data.split(":")[1]);
    if (!service) {
      await answerTelegramCallback(callbackId, "No encontrado");
      return;
    }

    await answerTelegramCallback(callbackId, "Producto");
    await sendTelegramProductCard(chatId, service);
    return;
  }

  if (data.startsWith("product_price:")) {
    const serviceId = data.split(":")[1];
    telegramBotSessions.set(chatId, { mode: "edit_service_price", serviceId });
    await answerTelegramCallback(callbackId, "Cambiar precio");
    await sendTelegramBotMessage(chatId, "Envíame el nuevo precio. Ejemplo: S/ 30");
    return;
  }

  if (data.startsWith("product_desc:")) {
    const serviceId = data.split(":")[1];
    telegramBotSessions.set(chatId, { mode: "edit_service_description", serviceId });
    await answerTelegramCallback(callbackId, "Cambiar descripción");
    await sendTelegramBotMessage(chatId, "Envíame la nueva descripción.");
    return;
  }

  if (data.startsWith("product_images:")) {
    const serviceId = data.split(":")[1];
    await answerTelegramCallback(callbackId, "Fotos");
    await sendTelegramBotMessage(chatId, "¿Qué quieres hacer con las fotos?", {
      inline_keyboard: [
        [
          { text: "Agregar fotos", callback_data: `product_images_add:${serviceId}` },
          { text: "Reemplazar todas", callback_data: `product_images_replace:${serviceId}` }
        ],
        [
          { text: "Volver", callback_data: `product_view:${serviceId}` }
        ]
      ]
    });
    return;
  }

  if (data.startsWith("product_images_add:")) {
    const serviceId = data.split(":")[1];
    telegramBotSessions.set(chatId, {
      mode: "edit_service_images",
      serviceId,
      imageMode: "add",
      images: null
    });
    await answerTelegramCallback(callbackId, "Agregar fotos");
    await sendTelegramBotMessage(chatId, "Envíame una o varias fotos. Cuando termines, escribe listo.");
    return;
  }

  if (data.startsWith("product_images_replace:")) {
    const serviceId = data.split(":")[1];
    telegramBotSessions.set(chatId, {
      mode: "edit_service_images",
      serviceId,
      imageMode: "replace",
      images: [],
      hasReplacedOnce: false
    });
    await answerTelegramCallback(callbackId, "Reemplazar fotos");
    await sendTelegramBotMessage(chatId, "Envíame las nuevas fotos. La primera reemplazará todas las anteriores. Cuando termines, escribe listo.");
    return;
  }

  if (data.startsWith("product_delete:")) {
    const service = findServiceByTelegramId(db, data.split(":")[1]);
    if (service) {
      db.run("DELETE FROM services WHERE id = ?", [service.id]);
      persistDatabase(db);
    }
    await answerTelegramCallback(callbackId, "Producto eliminado");
    await sendTelegramProductsMenu(chatId, db);
    return;
  }

  if (data.startsWith("product_status:")) {
    const serviceId = data.split(":")[1];
    await answerTelegramCallback(callbackId, "Elegir estado");
    await sendTelegramBotMessage(chatId, "Elige el nuevo estado:", {
      inline_keyboard: [
        [
          { text: "Disponible", callback_data: `status_set:${serviceId}:Disponible` },
          { text: "Nuevo", callback_data: `status_set:${serviceId}:Nuevo` }
        ],
        [
          { text: "Oferta", callback_data: `status_set:${serviceId}:Oferta` },
          { text: "Agotado", callback_data: `status_set:${serviceId}:Agotado` }
        ]
      ]
    });
    return;
  }

  if (data.startsWith("status_set:")) {
    const [, serviceId, status] = data.split(":");
    db.run("UPDATE services SET status = ? WHERE id = ?", [status, serviceId]);
    persistDatabase(db);
    await answerTelegramCallback(callbackId, "Estado actualizado");
    await sendTelegramProductsMenu(chatId, db);
    return;
  }

  await answerTelegramCallback(callbackId, "Acción no disponible");
}

async function sendTelegramProductsMenu(chatId, db) {
  const store = readStore(db);
  if (!store.services.length) {
    await sendTelegramBotMessage(chatId, "No hay productos cargados.");
    return;
  }

  await sendTelegramBotMessage(chatId, "Productos disponibles:", {
    inline_keyboard: [
      ...store.services.slice(0, 12).map((service) => ([
        { text: `${service.name.slice(0, 24)} | ${service.status}`, callback_data: `product_view:${service.id}` }
      ])),
      [{ text: "Volver al menú", callback_data: "menu_back" }]
    ]
  });
}

async function sendTelegramProductCard(chatId, service) {
  const price = service.priceOptions?.[0] || service.price;
  await sendTelegramBotMessage(
    chatId,
    [
      `Producto: ${service.name}`,
      `ID: ${service.id.slice(0, 8)}`,
      `Precio: ${price}`,
      `Estado: ${service.status}`,
      `Categoria: ${service.category}`,
      service.description ? `Descripcion: ${service.description}` : ""
    ].filter(Boolean).join("\n"),
    {
      inline_keyboard: [
        [
          { text: "Cambiar precio", callback_data: `product_price:${service.id}` },
          { text: "Cambiar estado", callback_data: `product_status:${service.id}` }
        ],
        [
          { text: "Cambiar fotos", callback_data: `product_images:${service.id}` },
          { text: "Cambiar descripción", callback_data: `product_desc:${service.id}` }
        ],
        [
          { text: "Eliminar", callback_data: `product_delete:${service.id}` }
        ],
        [
          { text: "Volver a productos", callback_data: "menu_products" }
        ]
      ]
    }
  );
}

async function sendTelegramCouponsMenu(chatId, db) {
  const store = readStore(db);
  const rows = store.coupons.slice(0, 10).flatMap((coupon) => ([
    [{ text: `${coupon.code} | ${coupon.active ? "Activo" : "Inactivo"}`, callback_data: "noop" }],
    [
      { text: coupon.active ? "Desactivar" : "Activar", callback_data: `coupon_toggle:${coupon.id}` },
      { text: "Eliminar", callback_data: `coupon_delete:${coupon.id}` }
    ]
  ]));

  rows.unshift([{ text: "Crear cupón", callback_data: "coupon_add" }]);
  rows.push([{ text: "Volver al menú", callback_data: "menu_back" }]);
  await sendTelegramBotMessage(chatId, "Panel de cupones:", { inline_keyboard: rows });
}

async function sendTelegramOrders(chatId, db) {
  const store = readStore(db);
  if (!store.orders.length) {
    await sendTelegramBotMessage(chatId, "No hay pedidos registrados.");
    return;
  }

  const lines = store.orders.slice(0, 10).map((order) => [
    `Servicio: ${order.serviceName}`,
    `Cliente: ${order.customerName}`,
    `Precio: ${order.finalPrice || order.servicePrice}`,
    order.couponCode ? `Cupón: ${order.couponCode}` : "",
    order.paymentProofUrl ? `Comprobante: ${order.paymentProofUrl}` : "",
    `Fecha: ${order.createdAt}`
  ].filter(Boolean).join("\n"));

  await sendTelegramBotMessage(chatId, lines.join("\n\n"), {
    inline_keyboard: [[{ text: "Volver al menú", callback_data: "menu_back" }]]
  });
}

async function sendTelegramSummary(chatId, db) {
  const store = readStore(db);
  await sendTelegramBotMessage(
    chatId,
    [
      `Servicios: ${store.services.length}`,
      `Pedidos: ${store.orders.length}`,
      `Cupones activos: ${store.coupons.filter((coupon) => coupon.active).length}`,
      `Reseñas: ${store.testimonials.length}`
    ].join("\n"),
    {
      inline_keyboard: [[{ text: "Volver al menú", callback_data: "menu_back" }]]
    }
  );
}

async function sendTelegramBotMessage(chatId, text, replyMarkup) {
  if (!TELEGRAM_BOT_TOKEN) {
    return;
  }

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup
    })
  });
}

async function answerTelegramCallback(callbackId, text) {
  if (!TELEGRAM_BOT_TOKEN || !callbackId) {
    return;
  }

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackId,
      text
    })
  });
}

async function storeTelegramMedia(message, cloudinaryEnabled) {
  if (!TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const photo = Array.isArray(message.photo) && message.photo.length
    ? message.photo[message.photo.length - 1]
    : null;
  const document = message.document || null;
  const fileId = photo?.file_id || document?.file_id;

  if (!fileId) {
    return null;
  }

  const fileInfoResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const fileInfo = await fileInfoResponse.json();
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    return null;
  }

  const filePath = fileInfo.result.file_path;
  const downloadResponse = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!downloadResponse.ok) {
    return null;
  }

  const arrayBuffer = await downloadResponse.arrayBuffer();
  const originalName = document?.file_name || path.basename(filePath) || `telegram-${Date.now()}.jpg`;

  return storeUploadedFile(
    {
      originalname: originalName,
      buffer: Buffer.from(arrayBuffer)
    },
    cloudinaryEnabled
  );
}

async function main() {
  const SQL = await initSqlJs();
  const app = express();
  const db = loadDatabase(SQL);
  const emailClient = createEmailClient();
  const cloudinaryEnabled = configureCloudinary();

  ensureSchema(db);
  ensureSeedData(db);
  migrateLegacyData(db);
  persistDatabase(db);

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax"
      }
    })
  );

  app.get("/api/public-store", (request, response) => {
    const store = readStore(db);
    delete store.orders;
    delete store.coupons;
    response.json(store);
  });

  app.post("/api/orders", async (request, response) => {
    const payload = normalizeOrderInput(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_order" });
      return;
    }

    const store = readStore(db);
    const couponResult = applyCoupon(payload.servicePrice, payload.couponCode, store.coupons, store.storeCurrency);
    const finalPrice = couponResult.finalPrice || payload.servicePrice;
    const message = [
      `Hola ${store.storeName}, quiero comprar este servicio:`,
      "",
      `Servicio: ${payload.serviceName}`,
      `Precio: ${finalPrice}`,
      `Cliente: ${payload.customerName}`,
      `Telefono: ${payload.customerPhone}`,
      payload.details ? `Detalles: ${payload.details}` : "",
      couponResult.appliedCode ? `Cupón: ${couponResult.appliedCode}` : "",
      payload.paymentProofUrl ? `Comprobante: ${payload.paymentProofUrl}` : "",
      "",
      "Pago en soles. Acepto transferencias de bancos del Peru."
    ].filter(Boolean).join("\n");

    const whatsappUrl = `https://wa.me/${store.whatsappNumber}?text=${encodeURIComponent(message)}`;

    db.run(
      "INSERT INTO orders (id, serviceName, servicePrice, finalPrice, customerName, customerPhone, details, couponCode, paymentProofUrl, paymentProofName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        crypto.randomUUID(),
        payload.serviceName,
        payload.servicePrice,
        finalPrice,
        payload.customerName,
        payload.customerPhone,
        payload.details || "",
        couponResult.appliedCode,
        payload.paymentProofUrl,
        payload.paymentProofName,
        new Date().toISOString()
      ]
    );
    persistDatabase(db);

    if (emailClient && store.storeEmail) {
      sendOrderEmail(emailClient, store, { ...payload, finalPrice, couponCode: couponResult.appliedCode }).catch((error) => {
        console.error("No se pudo enviar el correo.", error.message);
      });
    }

    sendTelegramNotification(store, { ...payload, finalPrice, couponCode: couponResult.appliedCode, whatsappUrl }).catch((error) => {
      console.error("No se pudo enviar Telegram.", error.message);
    });

    response.json({ ok: true, whatsappUrl, finalPrice });
  });

  app.post("/api/order-proof", upload.single("proof"), (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: "proof_required" });
      return;
    }

    storeUploadedFile(request.file, cloudinaryEnabled)
      .then((file) => response.json({ file }))
      .catch((error) => {
        console.error("No se pudo subir el comprobante.", error.message);
        response.status(500).json({ error: "proof_upload_failed" });
      });
  });

  app.get("/api/admin/session", (request, response) => {
    response.json({ authenticated: Boolean(request.session.isAdmin) });
  });

  app.post("/api/admin/login", (request, response) => {
    const username = String(request.body?.username || "").trim();
    const password = String(request.body?.password || "").trim();

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      response.status(401).json({ error: "invalid_credentials" });
      return;
    }

    request.session.isAdmin = true;
    response.json({ ok: true });
  });

  app.post("/api/admin/logout", (request, response) => {
    request.session.destroy(() => {
      response.json({ ok: true });
    });
  });

  app.get("/api/admin/store", requireAdmin, (request, response) => {
    response.json(readStore(db));
  });

  app.put("/api/admin/settings", requireAdmin, (request, response) => {
    const payload = normalizeSettingsInput(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_settings" });
      return;
    }

    writeSetting(db, "storeName", payload.storeName);
    writeSetting(db, "whatsappNumber", payload.whatsappNumber);
    writeSetting(db, "logoUrl", payload.logoUrl);
    writeSetting(db, "storeHandle", payload.storeHandle);
    writeSetting(db, "storeEmail", payload.storeEmail);
    writeSetting(db, "storeCurrency", payload.storeCurrency);
    writeSetting(db, "storeLanguage", payload.storeLanguage);
    writeSetting(db, "paymentHolder", payload.paymentHolder);
    writeSetting(db, "paymentQrUrl", payload.paymentQrUrl);
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.post("/api/admin/upload", requireAdmin, upload.array("images", 8), (request, response) => {
    const files = Array.isArray(request.files) ? request.files : [];
    Promise.all(files.map((file) => storeUploadedFile(file, cloudinaryEnabled)))
      .then((storedFiles) => {
        response.json({
          files: storedFiles
        });
      })
      .catch((error) => {
        console.error("No se pudo subir la imagen.", error.message);
        response.status(500).json({ error: "upload_failed" });
      });
  });

  app.post("/api/admin/services", requireAdmin, (request, response) => {
    const payload = normalizeServiceInput(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_service" });
      return;
    }

    db.run(
      "INSERT INTO services (id, name, category, status, price, priceOptionsJson, description, imagesJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), payload.name, payload.category, payload.status, payload.price, JSON.stringify(payload.priceOptions), payload.description, JSON.stringify(payload.images)]
    );
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.put("/api/admin/services/:id", requireAdmin, (request, response) => {
    const payload = normalizeServiceInput(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_service" });
      return;
    }

    if (!existsById(db, "services", request.params.id)) {
      response.status(404).json({ error: "service_not_found" });
      return;
    }

    db.run(
      "UPDATE services SET name = ?, category = ?, status = ?, price = ?, priceOptionsJson = ?, description = ?, imagesJson = ? WHERE id = ?",
      [payload.name, payload.category, payload.status, payload.price, JSON.stringify(payload.priceOptions), payload.description, JSON.stringify(payload.images), request.params.id]
    );
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.delete("/api/admin/services/:id", requireAdmin, (request, response) => {
    db.run("DELETE FROM services WHERE id = ?", [request.params.id]);
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.post("/api/admin/coupons", requireAdmin, (request, response) => {
    const payload = normalizeCouponInput(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_coupon" });
      return;
    }

    db.run(
      "INSERT INTO coupons (id, code, type, value, active) VALUES (?, ?, ?, ?, ?)",
      [crypto.randomUUID(), payload.code, payload.type, payload.value, payload.active ? 1 : 0]
    );
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.put("/api/admin/coupons/:id", requireAdmin, (request, response) => {
    const payload = normalizeCouponInput(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_coupon" });
      return;
    }

    db.run(
      "UPDATE coupons SET code = ?, type = ?, value = ?, active = ? WHERE id = ?",
      [payload.code, payload.type, payload.value, payload.active ? 1 : 0, request.params.id]
    );
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.delete("/api/admin/coupons/:id", requireAdmin, (request, response) => {
    db.run("DELETE FROM coupons WHERE id = ?", [request.params.id]);
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.post("/api/admin/testimonials", requireAdmin, (request, response) => {
    const payload = normalizeTestimonialInput(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_testimonial" });
      return;
    }

    db.run(
      "INSERT INTO testimonials (id, author, role, quote) VALUES (?, ?, ?, ?)",
      [crypto.randomUUID(), payload.author, payload.role, payload.quote]
    );
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.put("/api/admin/testimonials/:id", requireAdmin, (request, response) => {
    const payload = normalizeTestimonialInput(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_testimonial" });
      return;
    }

    if (!existsById(db, "testimonials", request.params.id)) {
      response.status(404).json({ error: "testimonial_not_found" });
      return;
    }

    db.run(
      "UPDATE testimonials SET author = ?, role = ?, quote = ? WHERE id = ?",
      [payload.author, payload.role, payload.quote, request.params.id]
    );
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.delete("/api/admin/testimonials/:id", requireAdmin, (request, response) => {
    db.run("DELETE FROM testimonials WHERE id = ?", [request.params.id]);
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.post("/api/admin/reset", requireAdmin, (request, response) => {
    resetStore(db);
    persistDatabase(db);
    response.json(readStore(db));
  });

  app.use("/uploads", express.static(UPLOADS_DIR));
  app.use(express.static(__dirname));

  app.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
  });

  startTelegramAdminBot({
    db,
    persistDatabase,
    cloudinaryEnabled
  });

  function requireAdmin(request, response, next) {
    if (!request.session.isAdmin) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }

    next();
  }

  function persistDatabase(database) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(database.export()));
  }
}

function loadDatabase(SQL) {
  if (!fs.existsSync(DB_PATH)) {
    return new SQL.Database();
  }

  return new SQL.Database(fs.readFileSync(DB_PATH));
}

function ensureSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      status TEXT NOT NULL DEFAULT 'Disponible',
      price TEXT NOT NULL,
      priceOptionsJson TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL,
      imagesJson TEXT NOT NULL DEFAULT '[]'
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      role TEXT NOT NULL,
      quote TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'percent',
      value REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      serviceName TEXT NOT NULL,
      servicePrice TEXT NOT NULL,
      finalPrice TEXT NOT NULL,
      customerName TEXT NOT NULL,
      customerPhone TEXT NOT NULL,
      details TEXT NOT NULL,
      couponCode TEXT NOT NULL DEFAULT '',
      paymentProofUrl TEXT NOT NULL DEFAULT '',
      paymentProofName TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL
    );
  `);

  ensureColumnExists(db, "services", "imagesJson", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumnExists(db, "services", "category", "TEXT NOT NULL DEFAULT 'General'");
  ensureColumnExists(db, "services", "status", "TEXT NOT NULL DEFAULT 'Disponible'");
  ensureColumnExists(db, "services", "priceOptionsJson", "TEXT NOT NULL DEFAULT '[]'");
}

function ensureSeedData(db) {
  const settingsCount = scalar(db, "SELECT COUNT(*) FROM settings");
  const servicesCount = scalar(db, "SELECT COUNT(*) FROM services");
  const testimonialsCount = scalar(db, "SELECT COUNT(*) FROM testimonials");
  const couponsCount = scalar(db, "SELECT COUNT(*) FROM coupons");

  if (settingsCount === 0 && servicesCount === 0 && testimonialsCount === 0 && couponsCount === 0) {
    resetStore(db);
  }
}

function migrateLegacyData(db) {
  const store = readStore(db);
  if (store.whatsappNumber === "51999999999") {
    writeSetting(db, "whatsappNumber", defaultStore.whatsappNumber);
  }

  if (!store.logoUrl || store.logoUrl === "assets/logo.jpg") {
    if (fs.existsSync(path.join(__dirname, "assets", "logo.jpeg"))) {
      writeSetting(db, "logoUrl", "assets/logo.jpeg");
    }
  }
}

function resetStore(db) {
  db.run("DELETE FROM settings");
  db.run("DELETE FROM services");
  db.run("DELETE FROM testimonials");
  db.run("DELETE FROM coupons");
  db.run("DELETE FROM orders");

  writeSetting(db, "storeName", defaultStore.storeName);
  writeSetting(db, "whatsappNumber", defaultStore.whatsappNumber);
  writeSetting(db, "logoUrl", defaultStore.logoUrl);
  writeSetting(db, "storeHandle", defaultStore.storeHandle);
  writeSetting(db, "storeEmail", defaultStore.storeEmail);
  writeSetting(db, "storeCurrency", defaultStore.storeCurrency);
  writeSetting(db, "storeLanguage", defaultStore.storeLanguage);
  writeSetting(db, "paymentHolder", defaultStore.paymentHolder);
  writeSetting(db, "paymentQrUrl", defaultStore.paymentQrUrl);

  for (const service of defaultStore.services) {
    db.run(
      "INSERT INTO services (id, name, category, status, price, priceOptionsJson, description, imagesJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [service.id, service.name, service.category || "General", service.status || "Disponible", service.price, JSON.stringify(service.priceOptions || []), service.description, JSON.stringify(service.images)]
    );
  }

  for (const coupon of defaultStore.coupons) {
    db.run(
      "INSERT INTO coupons (id, code, type, value, active) VALUES (?, ?, ?, ?, ?)",
      [coupon.id, coupon.code, coupon.type, coupon.value, coupon.active ? 1 : 0]
    );
  }

  for (const testimonial of defaultStore.testimonials) {
    db.run(
      "INSERT INTO testimonials (id, author, role, quote) VALUES (?, ?, ?, ?)",
      [testimonial.id, testimonial.author, testimonial.role, testimonial.quote]
    );
  }
}

function writeSetting(db, key, value) {
  db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

function readStore(db) {
  const settingsRows = rows(db, "SELECT key, value FROM settings");
  const services = rows(db, "SELECT id, name, category, status, price, priceOptionsJson, description, imagesJson FROM services ORDER BY rowid DESC").map((service) => ({
    id: service.id,
    name: service.name,
    category: service.category || "General",
    status: service.status || "Disponible",
    price: service.price,
    priceOptions: safeJsonArray(service.priceOptionsJson),
    description: service.description,
    images: safeJsonArray(service.imagesJson)
  }));
  const testimonials = rows(db, "SELECT id, author, role, quote FROM testimonials ORDER BY rowid DESC");
  const coupons = rows(db, "SELECT id, code, type, value, active FROM coupons ORDER BY rowid DESC").map((coupon) => ({
    ...coupon,
    value: Number(coupon.value) || 0,
    active: Number(coupon.active) === 1
  }));
  const orders = rows(db, "SELECT id, serviceName, servicePrice, finalPrice, customerName, customerPhone, details, couponCode, paymentProofUrl, paymentProofName, createdAt FROM orders ORDER BY createdAt DESC");
  const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));

  return {
    storeName: settings.storeName || defaultStore.storeName,
    whatsappNumber: settings.whatsappNumber || defaultStore.whatsappNumber,
    logoUrl: settings.logoUrl || defaultStore.logoUrl,
    storeHandle: settings.storeHandle || defaultStore.storeHandle,
    storeEmail: settings.storeEmail || defaultStore.storeEmail,
    storeCurrency: settings.storeCurrency || defaultStore.storeCurrency,
    storeLanguage: settings.storeLanguage || defaultStore.storeLanguage,
    paymentHolder: settings.paymentHolder || defaultStore.paymentHolder,
    paymentQrUrl: settings.paymentQrUrl || defaultStore.paymentQrUrl,
    services,
    coupons,
    orders,
    testimonials
  };
}

function normalizeSettingsInput(body) {
  const storeName = String(body?.storeName || "").trim();
  const whatsappNumber = String(body?.whatsappNumber || "").replace(/[^\d]/g, "");
  const logoUrl = normalizeAssetPath(String(body?.logoUrl || "").trim());
  const storeHandle = String(body?.storeHandle || "").trim();
  const storeEmail = String(body?.storeEmail || "").trim();
  const storeCurrency = String(body?.storeCurrency || "").trim() || "S/";
  const storeLanguage = String(body?.storeLanguage || "").trim() || "es";
  const paymentHolder = String(body?.paymentHolder || "").trim();
  const paymentQrUrl = normalizeAssetPath(String(body?.paymentQrUrl || "").trim());

  if (!storeName || !whatsappNumber || !logoUrl || !storeEmail) {
    return null;
  }

  return { storeName, whatsappNumber, logoUrl, storeHandle, storeEmail, storeCurrency, storeLanguage, paymentHolder, paymentQrUrl };
}

function normalizeServiceInput(body) {
  const name = String(body?.name || "").trim();
  const category = String(body?.category || "").trim() || "General";
  const status = String(body?.status || "").trim() || "Disponible";
  const price = String(body?.price || "").trim();
  const priceOptions = normalizePriceOptions(body?.priceOptions);
  const description = String(body?.description || "").trim();
  const images = normalizeImageList(body?.images);

  if (!name || !price || !description || images.length === 0) {
    return null;
  }

  return { name, category, status, price, priceOptions, description, images };
}

function normalizeCouponInput(body) {
  const code = String(body?.code || "").trim().toUpperCase();
  const type = String(body?.type || "").trim() === "fixed" ? "fixed" : "percent";
  const value = Number(body?.value || 0);
  const active = Boolean(body?.active);

  if (!code || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return { code, type, value, active };
}

function normalizeTestimonialInput(body) {
  const author = String(body?.author || "").trim();
  const role = String(body?.role || "").trim();
  const quote = String(body?.quote || "").trim();

  if (!author || !role || !quote) {
    return null;
  }

  return { author, role, quote };
}

function normalizeOrderInput(body) {
  const serviceName = String(body?.serviceName || "").trim();
  const servicePrice = String(body?.servicePrice || "").trim();
  const customerName = String(body?.customerName || "").trim();
  const customerPhone = String(body?.customerPhone || "").trim();
  const details = String(body?.details || "").trim();
  const couponCode = String(body?.couponCode || "").trim().toUpperCase();
  const paymentProofUrl = normalizeAssetPath(String(body?.paymentProofUrl || "").trim());
  const paymentProofName = String(body?.paymentProofName || "").trim();

  if (!serviceName || !servicePrice || !customerName || !customerPhone) {
    return null;
  }

  return { serviceName, servicePrice, customerName, customerPhone, details, couponCode, paymentProofUrl, paymentProofName };
}

function normalizePriceOptions(priceOptionsValue) {
  if (Array.isArray(priceOptionsValue)) {
    return priceOptionsValue.map((value) => String(value || "").trim()).filter(Boolean);
  }

  if (typeof priceOptionsValue === "string") {
    return priceOptionsValue.split("\n").map((value) => String(value || "").trim()).filter(Boolean);
  }

  return [];
}

function normalizeImageList(imagesValue) {
  let values = [];
  if (Array.isArray(imagesValue)) {
    values = imagesValue;
  } else if (typeof imagesValue === "string") {
    try {
      values = JSON.parse(imagesValue);
    } catch (error) {
      values = imagesValue.split("\n");
    }
  }

  return values
    .map((value) => normalizeAssetPath(String(value || "").trim()))
    .filter(Boolean);
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function normalizeAssetPath(value) {
  return value.replaceAll("\\", "/");
}

function existsById(db, tableName, id) {
  return scalar(db, `SELECT COUNT(*) FROM ${tableName} WHERE id = ?`, [id]) > 0;
}

function ensureColumnExists(db, tableName, columnName, definition) {
  const result = db.exec(`PRAGMA table_info(${tableName})`);
  const columns = result.length ? result[0].values.map((row) => String(row[1])) : [];
  if (!columns.includes(columnName)) {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function createEmailClient() {
  if (RESEND_API_KEY && RESEND_FROM) {
    return {
      provider: "resend",
      client: new Resend(RESEND_API_KEY),
      from: RESEND_FROM
    };
  }

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    return null;
  }

  return {
    provider: "smtp",
    client: nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    }),
    from: SMTP_FROM
  };
}

async function sendOrderEmail(emailClient, store, payload) {
  const subject = `Nueva solicitud para ${store.storeName}: ${payload.serviceName}`;
  const text = [
    `Negocio: ${store.storeName}`,
    `Servicio: ${payload.serviceName}`,
    `Precio: ${payload.finalPrice || payload.servicePrice}`,
    `Cliente: ${payload.customerName}`,
    `Telefono del cliente: ${payload.customerPhone}`,
    payload.details ? `Detalles: ${payload.details}` : "",
    payload.couponCode ? `Cupón: ${payload.couponCode}` : "",
    payload.paymentProofUrl ? `Comprobante: ${payload.paymentProofUrl}` : "",
    "",
    "Pagos en soles. Se aceptan bancos del Peru."
  ].filter(Boolean).join("\n");

  if (emailClient.provider === "resend") {
    const { error } = await emailClient.client.emails.send({
      from: emailClient.from,
      to: [store.storeEmail],
      subject,
      text
    });

    if (error) {
      throw new Error(error.message || "resend_failed");
    }

    return;
  }

  await emailClient.client.sendMail({
    from: emailClient.from,
    to: store.storeEmail,
    subject,
    text
  });
}

async function sendTelegramNotification(store, payload) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }

  const text = [
    `Nuevo pedido en ${store.storeName}`,
    `Servicio: ${payload.serviceName}`,
    `Precio: ${payload.finalPrice || payload.servicePrice}`,
    `Cliente: ${payload.customerName}`,
    `Telefono: ${payload.customerPhone}`,
    payload.details ? `Detalles: ${payload.details}` : "",
    payload.couponCode ? `Cupón: ${payload.couponCode}` : "",
    payload.paymentProofUrl ? `Comprobante: ${payload.paymentProofUrl}` : "",
    payload.whatsappUrl ? `WhatsApp: ${payload.whatsappUrl}` : ""
  ].filter(Boolean).join("\n");

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text
    })
  });

  if (!response.ok) {
    throw new Error("telegram_failed");
  }
}

function applyCoupon(priceText, couponCode, coupons, fallbackCurrency) {
  if (!couponCode) {
    return { finalPrice: priceText, appliedCode: "" };
  }

  const coupon = coupons.find((item) => item.active && item.code === couponCode);
  if (!coupon) {
    return { finalPrice: priceText, appliedCode: "" };
  }

  const numericPrice = extractNumericPrice(priceText);
  if (numericPrice === null) {
    return { finalPrice: priceText, appliedCode: coupon.code };
  }

  const discount = coupon.type === "fixed"
    ? coupon.value
    : (numericPrice * coupon.value) / 100;
  const finalNumeric = Math.max(0, numericPrice - discount);

  return {
    finalPrice: formatPrice(finalNumeric, priceText, fallbackCurrency),
    appliedCode: coupon.code
  };
}

function extractNumericPrice(value) {
  const matches = String(value || "").replaceAll(",", ".").match(/-?\d+(\.\d+)?/g);
  if (!matches || !matches.length) {
    return null;
  }

  return Number(matches[matches.length - 1]);
}

function formatPrice(value, template, fallbackCurrency = "S/") {
  const currency = String(template || "").match(/^[^\d-]+/)?.[0]?.trim() || fallbackCurrency;
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${currency} ${formatted}`.trim();
}

function configureCloudinary() {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return false;
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });

  return true;
}

async function storeUploadedFile(file, cloudinaryEnabled) {
  if (cloudinaryEnabled) {
    return uploadToCloudinary(file);
  }

  return saveFileLocally(file);
}

function saveFileLocally(file) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const extension = path.extname(file.originalname || "").toLowerCase() || ".jpg";
  const filename = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(absolutePath, file.buffer);

  return {
    url: `uploads/${filename}`,
    name: file.originalname
  };
}

function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        resource_type: "auto"
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error("cloudinary_upload_failed"));
          return;
        }

        resolve({
          url: result.secure_url,
          name: file.originalname
        });
      }
    );

    uploadStream.end(file.buffer);
  });
}

function scalar(db, query, params = []) {
  const result = db.exec(query, params);
  if (!result.length || !result[0].values.length) {
    return 0;
  }

  return Number(result[0].values[0][0]) || 0;
}

function rows(db, query, params = []) {
  const result = db.exec(query, params);
  if (!result.length) {
    return [];
  }

  const [{ columns, values }] = result;
  return values.map((valueRow) => Object.fromEntries(columns.map((column, index) => [column, valueRow[index]])));
}

main().catch((error) => {
  console.error("No se pudo iniciar el servidor.", error);
  process.exit(1);
});
