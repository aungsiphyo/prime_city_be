const crypto = require("crypto");
const QRCode = require("qrcode");

const TOKEN_PREFIX = "PCV1";
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

function sign(body) {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(body)
    .digest("base64url");
}

function createVisitorQrToken({ visitorId, qrId, validFrom, expiresAt }) {
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
  return `${TOKEN_PREFIX}.${body}.${sign(body)}`;
}

function verifyVisitorQrToken(token, now = new Date()) {
  const [prefix, body, signature, extra] = String(token || "").split(".");
  if (prefix !== TOKEN_PREFIX || !body || !signature || extra) {
    throw new Error("Invalid visitor pass");
  }

  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
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

async function createVisitorQrImageDataUrl(token) {
  const png = await QRCode.toBuffer(token, {
    type: "png",
    width: 640,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#081426", light: "#FFFFFF" },
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}

module.exports = {
  createVisitorQrToken,
  verifyVisitorQrToken,
  createVisitorQrImageDataUrl,
};
