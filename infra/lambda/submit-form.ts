import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET ?? "";
const RECAPTCHA_MIN_SCORE = 0.5;

type FormId = "608" | "644";

const WEBHOOK_URLS: Record<FormId, string> = {
  "608": process.env.CONTACT_WEBHOOK_URL ?? "",
  "644": process.env.CALLME_WEBHOOK_URL ?? "",
};

// Solo dígitos: si alguien necesita marcar internacional, usa "00" en vez de "+".
const PHONE_REGEX = /^\d{7,15}$/;
// Letras (incluye acentos/ñ), espacios, guiones y apóstrofes; nada de dígitos ni símbolos.
const NAME_REGEX = /^[\p{L}\s'-]+$/u;
const MIN_MESSAGE_LENGTH = 3;

const FIELD_LABELS: Record<string, string> = {
  nombre: "Nombre",
  email: "Email",
  telefono: "Teléfono",
  mensaje: "Mensaje",
  aceptacionEmails: "Suscripción a emails",
  "acceptance-563": "Acepta aviso legal y política de privacidad",
};

const FORM_META: Record<FormId, { subject: string; requiredFields: string[] }> = {
  "608": { subject: "Nuevo contacto web", requiredFields: ["email", "acceptance-563"] },
  "644": { subject: "Solicitud de llamada", requiredFields: ["telefono", "acceptance-563"] },
};

interface SubmitFormBody {
  formId?: string;
  fields?: Record<string, string>;
  idioma?: string;
  pagina?: string;
  recaptchaToken?: string;
}

function jsonResponse(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function verifyRecaptcha(token: string): Promise<boolean> {
  const params = new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token });
  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const result = (await response.json()) as { success?: boolean; score?: number };
  return Boolean(result.success) && (result.score === undefined || result.score >= RECAPTCHA_MIN_SCORE);
}

function buildFieldSummary(fields: Record<string, string>): Array<{ label: string; value: string }> {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => ({ label: FIELD_LABELS[key] ?? key, value }));
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { ok: false, error: "Falta el cuerpo de la petición." });
  }

  let body: SubmitFormBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return jsonResponse(400, { ok: false, error: "JSON inválido." });
  }

  const { formId, fields = {}, idioma = "es", pagina = "", recaptchaToken } = body;

  if (formId !== "608" && formId !== "644") {
    return jsonResponse(400, { ok: false, error: "formId desconocido." });
  }

  if (!recaptchaToken) {
    return jsonResponse(400, { ok: false, error: "Falta el token de reCAPTCHA." });
  }

  const recaptchaOk = await verifyRecaptcha(recaptchaToken);
  if (!recaptchaOk) {
    return jsonResponse(400, { ok: false, error: "Verificación de reCAPTCHA fallida." });
  }

  const meta = FORM_META[formId];
  for (const requiredField of meta.requiredFields) {
    const value = fields[requiredField];
    if (!value || String(value).trim() === "") {
      return jsonResponse(400, { ok: false, error: `Falta el campo obligatorio: ${requiredField}.` });
    }
  }

  // nombre, teléfono y mensaje son opcionales, pero si vienen rellenos deben tener formato válido.
  const telefono = fields.telefono?.trim();
  if (telefono && !PHONE_REGEX.test(telefono)) {
    return jsonResponse(400, { ok: false, error: "Teléfono inválido." });
  }
  const nombre = fields.nombre?.trim();
  if (nombre && !NAME_REGEX.test(nombre)) {
    return jsonResponse(400, { ok: false, error: "Nombre inválido." });
  }
  const mensaje = fields.mensaje?.trim();
  if (mensaje && mensaje.length < MIN_MESSAGE_LENGTH) {
    return jsonResponse(400, { ok: false, error: "El mensaje es demasiado corto." });
  }
  if (fields.email && !isValidEmail(fields.email)) {
    return jsonResponse(400, { ok: false, error: "Email inválido." });
  }

  // El envío real del email (desde facturacio@nimbustelecom.cat) lo hace el escenario de
  // Make.com correspondiente a este tipo de formulario; aquí solo reenviamos los datos ya
  // validados (reCAPTCHA verificado server-side, campos comprobados).
  const makeResponse = await fetch(WEBHOOK_URLS[formId], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      formId,
      subject: meta.subject,
      fields: buildFieldSummary(fields),
      idioma,
      pagina,
      replyTo: fields.email && isValidEmail(fields.email) ? fields.email : undefined,
    }),
  });

  if (!makeResponse.ok) {
    return jsonResponse(502, { ok: false, error: "No se ha podido reenviar el formulario a Make.com." });
  }

  return jsonResponse(200, { ok: true });
}
