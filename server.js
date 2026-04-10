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
      `Detalles: ${payload.details}`,
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
        payload.details,
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

  if (!serviceName || !servicePrice || !customerName || !customerPhone || !details) {
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
    `Detalles: ${payload.details}`,
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
    `Detalles: ${payload.details}`,
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
