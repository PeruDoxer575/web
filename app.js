let state = {
  storeName: "",
  whatsappNumber: "",
  logoUrl: "",
  storeHandle: "",
  storeEmail: "",
  paymentHolder: "",
  paymentQrUrl: "",
  services: [],
  testimonials: []
};

let selectedService = null;
let isAdminAuthenticated = false;
let editingTestimonialId = "";
let draggedServiceImageIndex = null;
let activeServiceCategory = "Todas";

const servicesGrid = document.querySelector("#services-grid");
const servicesFilters = document.querySelector("#services-filters");
const testimonialsGrid = document.querySelector("#testimonials-grid");
const whatsappLine = document.querySelector("#whatsapp-line");
const brandLogo = document.querySelector("#brand-logo");
const brandHandle = document.querySelector("#brand-handle");
const footerPhone = document.querySelector("#footer-phone");
const footerEmail = document.querySelector("#footer-email");
const floatingWhatsapp = document.querySelector("#floating-whatsapp");
const paymentCopy = document.querySelector("#payment-copy");
const paymentMethodCopy = document.querySelector("#payment-method-copy");
const paymentQrCard = document.querySelector("#payment-qr-card");
const paymentQrName = document.querySelector("#payment-qr-name");
const paymentQrImage = document.querySelector("#payment-qr-image");
const paymentQrPreview = document.querySelector("#payment-qr-preview");
const faqPaymentHolder = document.querySelector("#faq-payment-holder");
const orderModal = document.querySelector("#order-modal");
const adminModal = document.querySelector("#admin-modal");
const orderForm = document.querySelector("#order-form");
const adminLoginForm = document.querySelector("#admin-login-form");
const settingsForm = document.querySelector("#settings-form");
const paymentQrUpload = document.querySelector("#payment-qr-upload");
const serviceForm = document.querySelector("#service-form");
const serviceImagesInput = document.querySelector("#service-images-upload");
const serviceImagesText = document.querySelector("#service-images");
const serviceImageManager = document.querySelector("#service-image-manager");
const testimonialForm = document.querySelector("#testimonial-form");
const adminServicesList = document.querySelector("#admin-services-list");
const testimonialsAdminList = document.querySelector("#admin-testimonials-list");
const orderServiceName = document.querySelector("#order-service-name");
const orderServicePrice = document.querySelector("#order-service-price");
const orderServiceGallery = document.querySelector("#order-service-gallery");
const orderPaymentCopy = document.querySelector("#order-payment-copy");
const orderPaymentHolder = document.querySelector("#order-payment-holder");
const orderPaymentQr = document.querySelector("#order-payment-qr");
const openAdminButton = document.querySelector("#open-admin");
const openAdminFooterButton = document.querySelector("#open-admin-footer");
const cancelEditButton = document.querySelector("#cancel-edit");
const cancelTestimonialButton = document.querySelector("#cancel-testimonial-edit");
const resetDataButton = document.querySelector("#reset-data");
const logoutButton = document.querySelector("#logout-admin");
const serviceFormTitle = document.querySelector("#service-form-title");
const adminAuthView = document.querySelector("#admin-auth-view");
const adminDashboardView = document.querySelector("#admin-dashboard-view");
const adminStatus = document.querySelector("#admin-status");
const loginError = document.querySelector("#login-error");

bootstrap();

async function bootstrap() {
  bindEvents();
  renderServiceImageManager();
  await loadPublicStore();
  await checkAdminSession();
}

function bindEvents() {
  document.addEventListener("click", handleDocumentClick);
  orderForm.addEventListener("submit", handleOrderSubmit);
  adminLoginForm.addEventListener("submit", handleAdminLogin);
  settingsForm.addEventListener("submit", handleSettingsSubmit);
  paymentQrUpload.addEventListener("change", handlePaymentQrUpload);
  serviceForm.addEventListener("submit", handleServiceSubmit);
  testimonialForm.addEventListener("submit", handleTestimonialSubmit);
  serviceImagesInput.addEventListener("change", handleServiceImageUpload);
  serviceImagesText.addEventListener("input", renderServiceImageManager);
  if (serviceImageManager) {
    serviceImageManager.addEventListener("dragstart", handleServiceImageDragStart);
    serviceImageManager.addEventListener("dragover", handleServiceImageDragOver);
    serviceImageManager.addEventListener("drop", handleServiceImageDrop);
    serviceImageManager.addEventListener("dragend", clearServiceImageDragState);
    serviceImageManager.addEventListener("click", handleServiceImageManagerClick);
  }
  openAdminButton.addEventListener("click", () => toggleModal(adminModal, true));
  openAdminFooterButton.addEventListener("click", () => toggleModal(adminModal, true));
  cancelEditButton.addEventListener("click", resetServiceForm);
  cancelTestimonialButton.addEventListener("click", resetTestimonialForm);
  resetDataButton.addEventListener("click", handleResetData);
  logoutButton.addEventListener("click", handleAdminLogout);
}

async function loadPublicStore() {
  try {
    const response = await fetch("/api/public-store");
    state = await response.json();
    renderPublicContent();
  } catch (error) {
    servicesGrid.innerHTML = '<div class="empty-state">No se pudo cargar el catalogo.</div>';
  }
}

async function checkAdminSession() {
  try {
    const response = await fetch("/api/admin/session", { credentials: "same-origin" });
    const data = await response.json();
    isAdminAuthenticated = Boolean(data.authenticated);
  } catch (error) {
    isAdminAuthenticated = false;
  }

  await syncAdminView();
}

async function syncAdminView() {
  loginError.textContent = "";
  adminStatus.textContent = isAdminAuthenticated
    ? "Sesion iniciada. Panel listo para editar servicios, fotos y reseñas."
    : "Inicia sesion para administrar el catalogo.";

  adminAuthView.classList.toggle("hidden", isAdminAuthenticated);
  adminDashboardView.classList.toggle("hidden", !isAdminAuthenticated);

  if (isAdminAuthenticated) {
    await loadAdminStore();
  }
}

async function loadAdminStore() {
  try {
    const response = await fetch("/api/admin/store", { credentials: "same-origin" });
    if (response.status === 401) {
      isAdminAuthenticated = false;
      await syncAdminView();
      return;
    }

    state = await response.json();
    hydrateSettingsForm();
    renderPublicContent();
    renderAdminServices();
    renderAdminTestimonials();
  } catch (error) {
    adminStatus.textContent = "No se pudo cargar el panel.";
  }
}

function renderPublicContent() {
  renderBrand();
  renderFooterContact();
  renderFloatingWhatsapp();
  renderPaymentInfo();
  renderServiceFilters();
  renderPublicServices();
  renderTestimonials();
}

function renderServiceFilters() {
  const categories = ["Todas", ...new Set(state.services.map((service) => (service.category || "General").trim()).filter(Boolean))];

  if (!categories.includes(activeServiceCategory)) {
    activeServiceCategory = "Todas";
  }

  servicesFilters.innerHTML = categories
    .map(
      (category) => `
        <button class="service-filter ${category === activeServiceCategory ? "is-active" : ""}" type="button" data-service-category="${escapeHtml(category)}">
          ${escapeHtml(category)}
        </button>
      `
    )
    .join("");
}

function renderBrand() {
  const hasLogo = Boolean(state.logoUrl);
  brandLogo.classList.toggle("hidden", !hasLogo);
  if (hasLogo) {
    brandLogo.src = state.logoUrl;
  } else {
    brandLogo.removeAttribute("src");
  }

  const handle = (state.storeHandle || "").trim();
  brandHandle.classList.toggle("hidden", !handle);
  brandHandle.textContent = handle;
  whatsappLine.textContent = `Pedidos al WhatsApp ${state.whatsappNumber} y respaldo al correo ${state.storeEmail} de ${state.storeName}.`;
}

function renderFooterContact() {
  footerPhone.textContent = state.whatsappNumber ? `WhatsApp: +${state.whatsappNumber}` : "";
  footerEmail.textContent = state.storeEmail ? `Correo: ${state.storeEmail}` : "";
}

function renderPaymentInfo() {
  const holder = (state.paymentHolder || "").trim();
  const qrUrl = (state.paymentQrUrl || "").trim();

  paymentCopy.textContent = holder
    ? `El pago se realiza por Plin con QR a nombre de ${holder}, y puede enviarse desde cualquier banco del Perú que permita Plin.`
    : "El pago se realiza por Plin con QR y puede enviarse desde cualquier banco del Perú que permita Plin.";

  paymentMethodCopy.textContent = holder
    ? `Plin por QR a nombre de ${holder}. El cliente puede pagar desde cualquier banco compatible con Plin.`
    : "Plin por QR. El cliente puede pagar desde cualquier banco compatible con Plin.";
  faqPaymentHolder.textContent = holder
    ? `El QR de pago está a nombre de ${holder}.`
    : "El QR de pago se mostrará con el titular configurado en la tienda.";

  paymentQrCard.classList.toggle("hidden", !qrUrl);
  paymentQrName.textContent = holder ? `Titular: ${holder}` : "";

  if (qrUrl) {
    paymentQrImage.src = qrUrl;
  } else {
    paymentQrImage.removeAttribute("src");
  }
}

function renderPaymentQrPreview() {
  const qrUrl = settingsForm.paymentQrUrl.value.trim();
  paymentQrPreview.classList.toggle("hidden", !qrUrl);

  if (qrUrl) {
    paymentQrPreview.src = qrUrl;
  } else {
    paymentQrPreview.removeAttribute("src");
  }
}

function renderFloatingWhatsapp() {
  if (!state.whatsappNumber) {
    floatingWhatsapp.classList.add("hidden");
    return;
  }

  floatingWhatsapp.classList.remove("hidden");
  floatingWhatsapp.href = `https://wa.me/${state.whatsappNumber}`;
}

function renderPublicServices() {
  const filteredServices = activeServiceCategory === "Todas"
    ? state.services
    : state.services.filter((service) => (service.category || "General") === activeServiceCategory);

  if (!state.services.length) {
    servicesGrid.innerHTML = '<div class="empty-state">Todavia no hay servicios publicados.</div>';
    return;
  }

  if (!filteredServices.length) {
    servicesGrid.innerHTML = '<div class="empty-state">No hay servicios en esta categoria todavia.</div>';
    return;
  }

  servicesGrid.innerHTML = filteredServices
    .map((service) => {
      const images = service.images || [];
      const coverImage = images[0] || "";
      const previewImages = images.slice(0, 4);
      const remainingCount = Math.max(images.length - 4, 0);
      const previewGallery = previewImages.length > 1
        ? `
          <div class="service-preview-gallery">
            ${previewImages
              .map(
                (image, index) =>
                  `<button class="service-preview-button ${index === 0 ? "is-active" : ""}" type="button" data-service-thumb="true" data-main-src="${escapeHtml(image)}" aria-label="Ver imagen ${index + 1} de ${escapeHtml(service.name)}">
                    <img class="service-preview-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(service.name)}" loading="lazy">
                  </button>`
              )
              .join("")}
            ${remainingCount ? `<span class="service-preview-more">+${remainingCount}</span>` : ""}
          </div>
        `
        : "";

      return `
        <article class="service-card">
          ${coverImage ? `<img class="service-image" src="${escapeHtml(coverImage)}" alt="${escapeHtml(service.name)}" loading="lazy">` : ""}
          ${previewGallery}
          <div class="service-card-topline">
            <p class="service-tag">Compra directa</p>
            <span class="service-status service-status-${slugifyStatus(service.status || "Disponible")}">${escapeHtml(service.status || "Disponible")}</span>
          </div>
          <span class="service-category">${escapeHtml(service.category || "General")}</span>
          <div>
            <h3>${escapeHtml(service.name)}</h3>
            <p>${escapeHtml(service.description)}</p>
          </div>
          <div class="service-meta">
            <strong class="service-price">${escapeHtml(service.price)}</strong>
            ${(service.images?.length || 0) > 1 ? `<span class="service-gallery-count">${service.images.length} fotos</span>` : ""}
          </div>
          <button class="action-button full-width" type="button" data-order-id="${service.id}">Comprar ahora</button>
        </article>
      `;
    })
    .join("");
}

function renderTestimonials() {
  if (!state.testimonials.length) {
    testimonialsGrid.innerHTML = '<div class="empty-state">Todavia no hay reseñas publicadas.</div>';
    return;
  }

  testimonialsGrid.innerHTML = state.testimonials
    .map(
      (testimonial) => `
        <article class="testimonial-card">
          <p class="testimonial-quote">"${escapeHtml(testimonial.quote)}"</p>
          <div class="testimonial-author">
            <strong>${escapeHtml(testimonial.author)}</strong>
            <span>${escapeHtml(testimonial.role)}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderAdminServices() {
  if (!state.services.length) {
    adminServicesList.innerHTML = '<div class="empty-state">No hay servicios en el panel.</div>';
    return;
  }

  adminServicesList.innerHTML = state.services
    .map((service) => {
      const thumbs = (service.images || [])
        .map(
          (image, index) => `
            <div class="admin-thumb-wrap">
              <img class="admin-service-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(service.name)}" loading="lazy">
              ${index === 0 ? '<span class="admin-thumb-badge">Portada</span>' : ""}
            </div>
          `,
        )
        .join("");

      return `
        <article class="admin-service-item">
          <div class="admin-service-gallery">${thumbs}</div>
          <div>
            <h3>${escapeHtml(service.name)}</h3>
            <p class="admin-service-status service-status-${slugifyStatus(service.status || "Disponible")}">${escapeHtml(service.status || "Disponible")}</p>
            <p class="admin-service-category">${escapeHtml(service.category || "General")}</p>
            <p>${escapeHtml(service.description)}</p>
            <strong class="service-price">${escapeHtml(service.price)}</strong>
          </div>
          <div class="admin-service-actions">
            <button class="secondary-button" type="button" data-edit-id="${service.id}">Editar</button>
            <button class="danger-button" type="button" data-delete-id="${service.id}">Eliminar</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderAdminTestimonials() {
  if (!state.testimonials.length) {
    testimonialsAdminList.innerHTML = '<div class="empty-state">No hay reseñas en el panel.</div>';
    return;
  }

  testimonialsAdminList.innerHTML = state.testimonials
    .map(
      (testimonial) => `
        <article class="admin-service-item">
          <div>
            <h3>${escapeHtml(testimonial.author)}</h3>
            <p>${escapeHtml(testimonial.role)}</p>
            <p>${escapeHtml(testimonial.quote)}</p>
          </div>
          <div class="admin-service-actions">
            <button class="secondary-button" type="button" data-edit-testimonial-id="${testimonial.id}">Editar</button>
            <button class="danger-button" type="button" data-delete-testimonial-id="${testimonial.id}">Eliminar</button>
          </div>
        </article>
      `
    )
    .join("");
}

function hydrateSettingsForm() {
  settingsForm.whatsappNumber.value = state.whatsappNumber || "";
  settingsForm.logoUrl.value = state.logoUrl || "";
  settingsForm.storeHandle.value = state.storeHandle || "";
  settingsForm.storeEmail.value = state.storeEmail || "";
  settingsForm.storeName.value = state.storeName || "";
  settingsForm.paymentHolder.value = state.paymentHolder || "";
  settingsForm.paymentQrUrl.value = state.paymentQrUrl || "";
  renderPaymentQrPreview();
}

function handleDocumentClick(event) {
  const orderId = event.target.getAttribute("data-order-id");
  const editId = event.target.getAttribute("data-edit-id");
  const deleteId = event.target.getAttribute("data-delete-id");
  const editTestimonialId = event.target.getAttribute("data-edit-testimonial-id");
  const deleteTestimonialId = event.target.getAttribute("data-delete-testimonial-id");
  const serviceThumb = event.target.closest("[data-service-thumb='true']");
  const categoryFilter = event.target.closest("[data-service-category]");

  if (event.target.hasAttribute("data-close-modal")) {
    toggleModal(orderModal, false);
  }

  if (event.target.hasAttribute("data-close-admin")) {
    toggleModal(adminModal, false);
  }

  if (serviceThumb) {
    swapServiceImage(serviceThumb);
    return;
  }

  if (categoryFilter) {
    activeServiceCategory = categoryFilter.getAttribute("data-service-category") || "Todas";
    renderServiceFilters();
    renderPublicServices();
    return;
  }

  if (orderId) {
    openOrderModal(orderId);
  }

  if (editId) {
    hydrateServiceForm(editId);
  }

  if (deleteId) {
    deleteService(deleteId);
  }

  if (editTestimonialId) {
    hydrateTestimonialForm(editTestimonialId);
  }

  if (deleteTestimonialId) {
    deleteTestimonial(deleteTestimonialId);
  }
}

function swapServiceImage(trigger) {
  const nextImage = trigger.getAttribute("data-main-src");
  const card = trigger.closest(".service-card");
  const mainImage = card?.querySelector(".service-image");

  if (!card || !mainImage || !nextImage) {
    return;
  }

  mainImage.src = nextImage;
  card.querySelectorAll("[data-service-thumb='true']").forEach((button) => {
    button.classList.toggle("is-active", button === trigger);
  });
}

function openOrderModal(orderId) {
  selectedService = state.services.find((service) => service.id === orderId) || null;
  if (!selectedService) {
    return;
  }

  orderServiceName.textContent = selectedService.name;
  orderServicePrice.textContent = `Precio actual: ${selectedService.price}`;
  orderServiceGallery.innerHTML = (selectedService.images || [])
    .map((image) => `<img class="order-gallery-image" src="${escapeHtml(image)}" alt="${escapeHtml(selectedService.name)}" loading="lazy">`)
    .join("");
  orderPaymentCopy.textContent = state.paymentHolder
    ? `Paga por Plin a nombre de ${state.paymentHolder} y luego envía tu comprobante por WhatsApp para confirmar este pedido.`
    : "Realiza el pago por Plin y luego envía tu comprobante por WhatsApp para confirmar este pedido.";
  orderPaymentHolder.textContent = state.paymentHolder ? `Titular: ${state.paymentHolder}` : "";
  orderPaymentHolder.classList.toggle("hidden", !state.paymentHolder);
  orderPaymentQr.classList.toggle("hidden", !state.paymentQrUrl);
  if (state.paymentQrUrl) {
    orderPaymentQr.src = state.paymentQrUrl;
  } else {
    orderPaymentQr.removeAttribute("src");
  }
  orderForm.reset();
  toggleModal(orderModal, true);
}

function hydrateServiceForm(serviceId) {
  const service = state.services.find((item) => item.id === serviceId);
  if (!service) {
    return;
  }

  serviceForm.serviceId.value = service.id;
  serviceForm.name.value = service.name;
  serviceForm.category.value = service.category || "General";
  serviceForm.status.value = service.status || "Disponible";
  serviceForm.price.value = service.price;
  serviceForm.description.value = service.description;
  serviceImagesText.value = (service.images || []).join("\n");
  renderServiceImageManager();
  serviceFormTitle.textContent = "Editar servicio";
  cancelEditButton.classList.remove("hidden");
}

function hydrateTestimonialForm(testimonialId) {
  const testimonial = state.testimonials.find((item) => item.id === testimonialId);
  if (!testimonial) {
    return;
  }

  editingTestimonialId = testimonial.id;
  testimonialForm.author.value = testimonial.author;
  testimonialForm.role.value = testimonial.role;
  testimonialForm.quote.value = testimonial.quote;
  cancelTestimonialButton.classList.remove("hidden");
}

function handleOrderSubmit(event) {
  event.preventDefault();
  if (!selectedService) {
    return;
  }

  const formData = new FormData(orderForm);
  const customerName = formData.get("customerName")?.toString().trim();
  const customerPhone = formData.get("customerPhone")?.toString().trim();
  const details = formData.get("details")?.toString().trim();

  submitOrder({
    serviceName: selectedService.name,
    servicePrice: selectedService.price,
    customerName,
    customerPhone,
    details
  });
}

async function handleAdminLogin(event) {
  event.preventDefault();
  loginError.textContent = "";

  const formData = new FormData(adminLoginForm);
  const username = formData.get("username")?.toString().trim() || "";
  const password = formData.get("password")?.toString().trim() || "";

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      loginError.textContent = "Usuario o clave incorrectos.";
      return;
    }

    adminLoginForm.reset();
    isAdminAuthenticated = true;
    await syncAdminView();
  } catch (error) {
    loginError.textContent = "No se pudo iniciar sesion.";
  }
}

async function handleAdminLogout() {
  try {
    await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    isAdminAuthenticated = false;
    resetServiceForm();
    resetTestimonialForm();
    await syncAdminView();
  }
}

async function handleSettingsSubmit(event) {
  event.preventDefault();

  try {
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        storeName: settingsForm.storeName.value.trim(),
        whatsappNumber: sanitizePhone(settingsForm.whatsappNumber.value),
        logoUrl: settingsForm.logoUrl.value.trim(),
        storeHandle: settingsForm.storeHandle.value.trim(),
        storeEmail: settingsForm.storeEmail.value.trim(),
        paymentHolder: settingsForm.paymentHolder.value.trim(),
        paymentQrUrl: settingsForm.paymentQrUrl.value.trim()
      })
    });

    if (!response.ok) {
      throw new Error("settings");
    }

    state = await response.json();
    hydrateSettingsForm();
    renderPublicContent();
    renderAdminServices();
    renderAdminTestimonials();
  } catch (error) {
    adminStatus.textContent = "No se pudo guardar la configuracion.";
  }
}

async function handlePaymentQrUpload() {
  if (!paymentQrUpload.files?.length) {
    return;
  }

  const payload = new FormData();
  payload.append("images", paymentQrUpload.files[0]);

  try {
    const response = await fetch("/api/admin/upload", {
      method: "POST",
      body: payload,
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("upload_qr");
    }

    const data = await response.json();
    const uploadedQr = data.files?.[0]?.url || "";
    settingsForm.paymentQrUrl.value = uploadedQr;
    state.paymentQrUrl = uploadedQr;
    state.paymentHolder = settingsForm.paymentHolder.value.trim();
    renderPaymentQrPreview();
    renderPaymentInfo();
    paymentQrUpload.value = "";
    adminStatus.textContent = "QR subido correctamente. Guarda la configuracion para publicarlo.";
  } catch (error) {
    adminStatus.textContent = "No se pudo subir el QR.";
  }
}

async function handleServiceSubmit(event) {
  event.preventDefault();

  const formData = new FormData(serviceForm);
  const serviceId = formData.get("serviceId")?.toString().trim();
  const payload = {
    name: formData.get("name")?.toString().trim() || "",
    category: formData.get("category")?.toString().trim() || "General",
    status: formData.get("status")?.toString().trim() || "Disponible",
    price: formData.get("price")?.toString().trim() || "",
    description: formData.get("description")?.toString().trim() || "",
    images: serviceImagesText.value.split("\n").map((line) => line.trim()).filter(Boolean)
  };

  if (!payload.name || !payload.category || !payload.status || !payload.price || !payload.description || payload.images.length === 0) {
    adminStatus.textContent = "Completa nombre, categoria, estado, precio, descripcion y al menos una imagen.";
    return;
  }

  const endpoint = serviceId ? `/api/admin/services/${encodeURIComponent(serviceId)}` : "/api/admin/services";
  const method = serviceId ? "PUT" : "POST";

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("service");
    }

    state = await response.json();
    renderPublicContent();
    renderAdminServices();
    resetServiceForm();
  } catch (error) {
    adminStatus.textContent = "No se pudo guardar el servicio.";
  }
}

async function handleTestimonialSubmit(event) {
  event.preventDefault();

  const formData = new FormData(testimonialForm);
  const payload = {
    author: formData.get("author")?.toString().trim() || "",
    role: formData.get("role")?.toString().trim() || "",
    quote: formData.get("quote")?.toString().trim() || ""
  };

  if (!payload.author || !payload.role || !payload.quote) {
    adminStatus.textContent = "Completa todos los campos de la reseña.";
    return;
  }

  const endpoint = editingTestimonialId
    ? `/api/admin/testimonials/${encodeURIComponent(editingTestimonialId)}`
    : "/api/admin/testimonials";
  const method = editingTestimonialId ? "PUT" : "POST";

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("testimonial");
    }

    state = await response.json();
    renderPublicContent();
    renderAdminTestimonials();
    resetTestimonialForm();
  } catch (error) {
    adminStatus.textContent = "No se pudo guardar la reseña.";
  }
}

async function handleServiceImageUpload() {
  if (!serviceImagesInput.files?.length) {
    return;
  }

  const payload = new FormData();
  for (const file of serviceImagesInput.files) {
    payload.append("images", file);
  }

  try {
    const response = await fetch("/api/admin/upload", {
      method: "POST",
      body: payload,
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("upload");
    }

    const data = await response.json();
    const existing = serviceImagesText.value.split("\n").map((line) => line.trim()).filter(Boolean);
    const uploaded = data.files.map((file) => file.url);
    serviceImagesText.value = [...existing, ...uploaded].join("\n");
    renderServiceImageManager();
    serviceImagesInput.value = "";
    adminStatus.textContent = "Imagenes subidas correctamente.";
  } catch (error) {
    adminStatus.textContent = "No se pudieron subir las imagenes.";
  }
}

async function deleteService(serviceId) {
  try {
    const response = await fetch(`/api/admin/services/${encodeURIComponent(serviceId)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("delete");
    }

    state = await response.json();
    renderPublicContent();
    renderAdminServices();
    resetServiceForm();
  } catch (error) {
    adminStatus.textContent = "No se pudo eliminar el servicio.";
  }
}

async function deleteTestimonial(testimonialId) {
  try {
    const response = await fetch(`/api/admin/testimonials/${encodeURIComponent(testimonialId)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("delete_testimonial");
    }

    state = await response.json();
    renderPublicContent();
    renderAdminTestimonials();
    resetTestimonialForm();
  } catch (error) {
    adminStatus.textContent = "No se pudo eliminar la reseña.";
  }
}

async function handleResetData() {
  try {
    const response = await fetch("/api/admin/reset", {
      method: "POST",
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("reset");
    }

    state = await response.json();
    hydrateSettingsForm();
    renderPublicContent();
    renderAdminServices();
    renderAdminTestimonials();
    resetServiceForm();
    resetTestimonialForm();
  } catch (error) {
    adminStatus.textContent = "No se pudo restaurar la demo.";
  }
}

async function submitOrder(payload) {
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("order");
    }

    const data = await response.json();
    if (data.whatsappUrl) {
      window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
    }
    toggleModal(orderModal, false);
  } catch (error) {
    adminStatus.textContent = "No se pudo procesar el pedido.";
  }
}

function resetServiceForm() {
  serviceForm.reset();
  serviceImagesText.value = "";
  renderServiceImageManager();
  serviceForm.serviceId.value = "";
  serviceFormTitle.textContent = "Agregar servicio";
  cancelEditButton.classList.add("hidden");
}

function renderServiceImageManager() {
  if (!serviceImageManager) {
    return;
  }

  const images = getServiceImageList();

  if (!images.length) {
    serviceImageManager.innerHTML = '<div class="service-image-manager-empty">Las fotos que cargues aparecerán aquí para ordenarlas.</div>';
    return;
  }

  serviceImageManager.innerHTML = images
    .map(
      (image, index) => `
        <article class="service-image-sort-item" draggable="true" data-image-index="${index}">
          <div class="service-image-sort-media">
            <img class="service-image-sort-thumb" src="${escapeHtml(image)}" alt="Imagen ${index + 1}" loading="lazy">
            ${index === 0 ? '<span class="service-image-cover-badge">Portada</span>' : ""}
          </div>
          <div class="service-image-sort-info">
            <p class="service-image-sort-title">Imagen ${index + 1}</p>
            <p class="service-image-sort-path">${escapeHtml(image)}</p>
          </div>
          <div class="service-image-sort-actions">
            ${index === 0 ? "" : `<button class="ghost-button" type="button" data-make-cover="${index}">Poner portada</button>`}
            <button class="danger-button" type="button" data-remove-image="${index}">Quitar</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function handleServiceImageDragStart(event) {
  const item = event.target.closest("[data-image-index]");
  if (!item) {
    return;
  }

  draggedServiceImageIndex = Number(item.getAttribute("data-image-index"));
  item.classList.add("is-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(draggedServiceImageIndex));
  }
}

function handleServiceImageDragOver(event) {
  const item = event.target.closest("[data-image-index]");
  if (!item) {
    return;
  }

  event.preventDefault();
  clearServiceImageDropTargets();
  item.classList.add("is-drop-target");
}

function handleServiceImageDrop(event) {
  const item = event.target.closest("[data-image-index]");
  if (!item || draggedServiceImageIndex === null) {
    return;
  }

  event.preventDefault();
  const targetIndex = Number(item.getAttribute("data-image-index"));
  reorderServiceImages(draggedServiceImageIndex, targetIndex);
}

function clearServiceImageDragState() {
  draggedServiceImageIndex = null;
  if (!serviceImageManager) {
    return;
  }

  serviceImageManager.querySelectorAll(".service-image-sort-item").forEach((item) => {
    item.classList.remove("is-dragging");
  });
  clearServiceImageDropTargets();
}

function clearServiceImageDropTargets() {
  if (!serviceImageManager) {
    return;
  }

  serviceImageManager.querySelectorAll(".service-image-sort-item").forEach((item) => {
    item.classList.remove("is-drop-target");
  });
}

function handleServiceImageManagerClick(event) {
  const removeIndex = event.target.getAttribute("data-remove-image");
  const makeCoverIndex = event.target.getAttribute("data-make-cover");

  if (removeIndex !== null) {
    const images = getServiceImageList();
    images.splice(Number(removeIndex), 1);
    setServiceImageList(images);
    return;
  }

  if (makeCoverIndex !== null) {
    reorderServiceImages(Number(makeCoverIndex), 0);
  }
}

function reorderServiceImages(fromIndex, toIndex) {
  if (Number.isNaN(fromIndex) || Number.isNaN(toIndex) || fromIndex === toIndex) {
    clearServiceImageDragState();
    return;
  }

  const images = getServiceImageList();
  const [moved] = images.splice(fromIndex, 1);
  images.splice(toIndex, 0, moved);
  setServiceImageList(images);
  clearServiceImageDragState();
}

function getServiceImageList() {
  return serviceImagesText.value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function setServiceImageList(images) {
  serviceImagesText.value = images.join("\n");
  renderServiceImageManager();
}

function resetTestimonialForm() {
  testimonialForm.reset();
  editingTestimonialId = "";
  cancelTestimonialButton.classList.add("hidden");
}

function toggleModal(modal, show) {
  modal.classList.toggle("hidden", !show);
  modal.setAttribute("aria-hidden", String(!show));
}

function sanitizePhone(phone) {
  return phone.replace(/[^\d]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugifyStatus(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
