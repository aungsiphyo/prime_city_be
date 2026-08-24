const crypto = require("crypto");
const QRCode = require("qrcode");

const LEGACY_TOKEN_PREFIX = "PCV1";
const COMPACT_TOKEN_PREFIX = "PCV2";
const COMPACT_SIGNATURE_BYTES = 16;
const DERIVED_KEY_CONTEXT = "prime-city:visitor-qr:v1";

function signingSecret() {
  const secret = String(
    process.env.VISITOR_QR_SIGNING_SECRET || process.env.JWT_SECRET || ""
  ).trim();
  if (!secret) {
    const error = new Error("Visitor QR signing is not configured");
    error.code = "VISITOR_QR_NOT_CONFIGURED";
    throw error;
  }

  // Preserve signatures created with an existing 32+ character secret.
  // Older deployments sometimes use a shorter JWT_SECRET; derive a fixed-size
  // purpose-specific HMAC key so visitor QR can remain backward compatible
  // without using that raw key directly for a second purpose.
  if (secret.length >= 32) return secret;

  return crypto
    .createHash("sha256")
    .update(DERIVED_KEY_CONTEXT)
    .update("\0")
    .update(secret)
    .digest();
}

function signLegacy(body) {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(body)
    .digest("base64url");
}

function signCompact(qrId) {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(`${COMPACT_TOKEN_PREFIX}.${qrId}`)
    .digest()
    .subarray(0, COMPACT_SIGNATURE_BYTES)
    .toString("base64url");
}

function signaturesMatch(expected, received) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function createVisitorQrId() {
  return crypto.randomBytes(16).toString("base64url");
}

// PCV2 deliberately keeps only an unguessable QR identifier and a truncated
// 128-bit HMAC in the QR. Schedule and visitor details remain in MongoDB. This
// makes the code roughly the same density as the existing form URL, which is
// substantially easier for an ESP32-CAM to focus and decode.
function createVisitorQrToken({ qrId }) {
  const normalizedQrId = String(qrId || "").trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(normalizedQrId)) {
    throw new Error("Visitor QR identifier is invalid");
  }
  return `${COMPACT_TOKEN_PREFIX}.${normalizedQrId}.${signCompact(
    normalizedQrId
  )}`;
}

// Kept only so PCV1 passes created before the compact-token deployment remain
// verifiable until their original expiry time.
function createLegacyVisitorQrToken({ visitorId, qrId, validFrom, expiresAt }) {
  const payload = {
    v: 1,
    vid: String(visitorId),
    qid: String(qrId),
    nbf: Math.floor(new Date(validFrom).getTime() / 1000),
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
  };
  if (!payload.vid || !payload.qid || !payload.nbf || !payload.exp) {
    throw new Error("Visitor QR schedule is invalid");
  }
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${LEGACY_TOKEN_PREFIX}.${body}.${signLegacy(body)}`;
}

function verifyLegacyVisitorQrToken(token, now) {
  const [prefix, body, signature, extra] = String(token || "").split(".");
  if (prefix !== LEGACY_TOKEN_PREFIX || !body || !signature || extra) {
    throw new Error("Invalid visitor pass");
  }

  if (!signaturesMatch(signLegacy(body), signature)) {
    throw new Error("Invalid visitor pass signature");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (_error) {
    throw new Error("Invalid visitor pass payload");
  }
  if (
    payload.v !== 1 ||
    !payload.vid ||
    !payload.qid ||
    !Number.isInteger(payload.nbf) ||
    !Number.isInteger(payload.exp)
  ) {
    throw new Error("Invalid visitor pass payload");
  }

  const nowSeconds = Math.floor(new Date(now).getTime() / 1000);
  if (nowSeconds < payload.nbf) {
    const error = new Error("Visitor pass is not active yet");
    error.code = "NOT_ACTIVE";
    throw error;
  }
  if (nowSeconds > payload.exp) {
    const error = new Error("Visitor pass has expired");
    error.code = "EXPIRED";
    throw error;
  }
  return payload;
}

function verifyVisitorQrToken(token, now = new Date()) {
  const normalizedToken = String(token || "").trim();
  const [prefix, qrId, signature, extra] = normalizedToken.split(".");

  if (prefix === COMPACT_TOKEN_PREFIX) {
    if (
      !/^[A-Za-z0-9_-]{16,64}$/.test(qrId || "") ||
      !/^[A-Za-z0-9_-]{22}$/.test(signature || "") ||
      extra ||
      !signaturesMatch(signCompact(qrId), signature)
    ) {
      throw new Error("Invalid visitor pass signature");
    }
    return { v: 2, qid: qrId };
  }

  return verifyLegacyVisitorQrToken(normalizedToken, now);
}

async function createVisitorQrImageDataUrl(token) {
  const png = await QRCode.toBuffer(token, {
    type: "png",
    width: 640,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#081426", light: "#FFFFFF" },
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}

module.exports = {
  createVisitorQrId,
  createVisitorQrToken,
  createLegacyVisitorQrToken,
  verifyVisitorQrToken,
  createVisitorQrImageDataUrl,
};
