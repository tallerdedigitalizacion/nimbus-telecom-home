(() => {
  "use strict";

  // Sustituye al bundle original de Contact Form 7 (que llamaba a wp-json/contact-form-7),
  // que dejó de funcionar al no haber WordPress detrás. Envía los mismos 2 formularios
  // (608 y 644) a un backend propio (API Gateway + Lambda), que reenvía a un webhook de
  // Make.com para el envío del email. Ver infra/.
  const API_ENDPOINT = "https://s52kyxxyu3.execute-api.eu-west-1.amazonaws.com/submit-form";
  const DEFAULT_LANGUAGE = "es";

  const FORM_RULES = {
    608: { required: ["email", "acceptance-563"] },
    644: { required: ["telefono", "acceptance-563"] },
  };

  const MESSAGES = {
    invalid: "Por favor, revisa los campos obligatorios.",
    sending: "Enviando...",
    success: "Gracias, hemos recibido tu mensaje. Te contactaremos lo antes posible.",
    error: "No se ha podido enviar el formulario. Inténtalo de nuevo más tarde.",
  };

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  // Solo dígitos: si alguien necesita marcar internacional, usa "00" en vez de "+".
  const PHONE_REGEX = /^\d{7,15}$/;
  // Letras (incluye acentos/ñ), espacios, guiones y apóstrofes; nada de dígitos ni símbolos.
  const NAME_REGEX = /^[\p{L}\s'-]+$/u;
  const MIN_MESSAGE_LENGTH = 3;

  // GTranslate ("on the fly", sin subcarpetas /en//ca/) guarda el idioma activo en esta cookie.
  const getLanguage = () => {
    const match = document.cookie.match(/googtrans=\/[a-zA-Z-]*\/([a-zA-Z-]+)/);
    return match ? match[1] : DEFAULT_LANGUAGE;
  };

  const getFormId = (form) => {
    const input = form.querySelector('input[name="_wpcf7"]');
    return input ? input.value : null;
  };

  const collectFields = (form) => {
    const fields = {};
    Array.prototype.forEach.call(form.elements, (el) => {
      if (!el.name || el.name.charAt(0) === "_" || el.type === "submit" || el.type === "button") return;
      fields[el.name] = el.type === "checkbox" ? (el.checked ? "1" : "") : (el.value || "").trim();
    });
    return fields;
  };

  const validate = (formId, fields) => {
    const rules = FORM_RULES[formId];
    if (!rules) return false;
    if (rules.required.some((name) => !fields[name])) return false;
    if (fields.email && !isValidEmail(fields.email)) return false;
    // telefono, nombre y mensaje son opcionales, pero si vienen rellenos deben ser válidos.
    const telefono = (fields.telefono || "").trim();
    if (telefono && !PHONE_REGEX.test(telefono)) return false;
    const nombre = (fields.nombre || "").trim();
    if (nombre && !NAME_REGEX.test(nombre)) return false;
    const mensaje = (fields.mensaje || "").trim();
    if (mensaje && mensaje.length < MIN_MESSAGE_LENGTH) return false;
    return true;
  };

  const showMessage = (form, text, isError) => {
    const output = form.querySelector(".wpcf7-response-output");
    if (!output) return;
    output.textContent = text;
    output.setAttribute("aria-hidden", "false");
    output.classList.toggle("wpcf7-mail-sent-ok", !isError);
    output.classList.toggle("wpcf7-validation-errors", isError);
  };

  const setSubmitting = (form, isSubmitting) => {
    form.querySelectorAll('input[type="submit"]').forEach((btn) => {
      btn.disabled = isSubmitting;
    });
    form.classList.toggle("submitting", isSubmitting);
  };

  // El módulo de reCAPTCHA de CF7 (modules/recaptcha) ya ejecuta grecaptcha con este mismo
  // sitekey/action en cada page load y en cada "change" del documento; lo reutilizamos aquí
  // en vez de duplicar esa configuración, pidiendo un token fresco en el momento del envío.
  const getRecaptchaToken = () =>
    new Promise((resolve, reject) => {
      if (typeof grecaptcha === "undefined" || typeof wpcf7_recaptcha === "undefined") {
        reject(new Error("recaptcha no disponible"));
        return;
      }
      const action = (wpcf7_recaptcha.actions && wpcf7_recaptcha.actions.contactform) || "contactform";
      grecaptcha.ready(() => {
        grecaptcha.execute(wpcf7_recaptcha.sitekey, { action }).then(resolve, reject);
      });
    });

  const onSubmit = (event) => {
    const form = event.target;
    if (!form || !form.classList || !form.classList.contains("wpcf7-form")) return;

    event.preventDefault();
    event.stopPropagation();

    const formId = getFormId(form);
    const fields = collectFields(form);

    if (!validate(formId, fields)) {
      showMessage(form, MESSAGES.invalid, true);
      return;
    }

    setSubmitting(form, true);
    showMessage(form, MESSAGES.sending, false);

    getRecaptchaToken()
      .then((recaptchaToken) =>
        fetch(API_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            formId,
            fields,
            idioma: getLanguage(),
            pagina: window.location.href,
            recaptchaToken,
          }),
        }),
      )
      .then((response) => {
        if (!response.ok) throw new Error("request failed");
        return response.json();
      })
      .then((data) => {
        if (!data || !data.ok) throw new Error("backend error");
        showMessage(form, MESSAGES.success, false);
        form.reset();
      })
      .catch(() => {
        showMessage(form, MESSAGES.error, true);
      })
      .then(() => {
        setSubmitting(form, false);
      });
  };

  document.addEventListener("submit", onSubmit, true);
})();
