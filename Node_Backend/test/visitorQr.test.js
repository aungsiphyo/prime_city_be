const assert = require("node:assert/strict");
const test = require("node:test");
const QRCode = require("qrcode");
const visitorRouter = require("../src/routes/visitor");
const {
  createVisitorQrId,
  createVisitorQrToken,
  createLegacyVisitorQrToken,
  verifyVisitorQrToken,
  createVisitorQrImageDataUrl,
} = require("../src/services/visitorQr.service");

function findRoute(router, method, path) {
  return router.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method]
  );
}

test("pre-registered visitor QR retrieval requires authentication", () => {
  const layer = findRoute(visitorRouter, "get", "/:id/qr");
  assert.ok(layer);
  assert.equal(layer.route.stack[0].handle.name, "protect");
});

test("new visitor passes use a compact signed PCV2 token for ESP32-CAM", () => {
  const previous = process.env.VISITOR_QR_SIGNING_SECRET;
  process.env.VISITOR_QR_SIGNING_SECRET =
    "test-only-visitor-qr-secret-that-is-long-enough";
  try {
    const qrId = createVisitorQrId();
    const token = createVisitorQrToken({ qrId });
    const payload = verifyVisitorQrToken(token);

    assert.equal(qrId.length, 22);
    assert.equal(payload.v, 2);
    assert.equal(payload.qid, qrId);
    assert.match(token, /^PCV2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(token.length <= 50, `compact QR token is ${token.length} chars`);
    assert.ok(
      QRCode.create(token, { errorCorrectionLevel: "M" }).modules.size <= 33
    );
    assert.throws(
      () => verifyVisitorQrToken(`${token.slice(0, -1)}x`),
      /signature|Invalid visitor pass/
    );
  } finally {
    if (previous === undefined) delete process.env.VISITOR_QR_SIGNING_SECRET;
    else process.env.VISITOR_QR_SIGNING_SECRET = previous;
  }
});

test("existing PCV1 passes remain signed, time-bound, and accepted", () => {
  const previous = process.env.VISITOR_QR_SIGNING_SECRET;
  process.env.VISITOR_QR_SIGNING_SECRET =
    "test-only-visitor-qr-secret-that-is-long-enough";
  try {
    const now = new Date("2026-08-18T06:00:00.000Z");
    const token = createLegacyVisitorQrToken({
      visitorId: "507f1f77bcf86cd799439011",
      qrId: "d8b7635a-943c-43d8-9d65-9c3083613983",
      validFrom: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 60000),
    });
    const payload = verifyVisitorQrToken(token, now);
    assert.equal(payload.v, 1);
    assert.equal(payload.vid, "507f1f77bcf86cd799439011");
    assert.throws(
      () => verifyVisitorQrToken(token, new Date(now.getTime() + 120000)),
      /expired/
    );
  } finally {
    if (previous === undefined) delete process.env.VISITOR_QR_SIGNING_SECRET;
    else process.env.VISITOR_QR_SIGNING_SECRET = previous;
  }
});

test("visitor pass QR image is generated locally without exposing a public URL", async () => {
  const previous = process.env.VISITOR_QR_SIGNING_SECRET;
  process.env.VISITOR_QR_SIGNING_SECRET =
    "test-only-visitor-qr-secret-that-is-long-enough";
  try {
    const token = createVisitorQrToken({
      qrId: createVisitorQrId(),
    });
    const image = await createVisitorQrImageDataUrl(token);
    assert.match(image, /^data:image\/png;base64,/);
    assert.ok(image.length > 1000);
  } finally {
    if (previous === undefined) delete process.env.VISITOR_QR_SIGNING_SECRET;
    else process.env.VISITOR_QR_SIGNING_SECRET = previous;
  }
});

test("visitor passes support an existing short JWT secret through a derived key", () => {
  const previousVisitorSecret = process.env.VISITOR_QR_SIGNING_SECRET;
  const previousJwtSecret = process.env.JWT_SECRET;
  delete process.env.VISITOR_QR_SIGNING_SECRET;
  process.env.JWT_SECRET = "legacy-jwt-secret";

  try {
    const token = createVisitorQrToken({
      qrId: "825135f1-91df-4a75-b225-30117241498b",
    });

    assert.equal(
      verifyVisitorQrToken(token).qid,
      "825135f1-91df-4a75-b225-30117241498b"
    );
  } finally {
    if (previousVisitorSecret === undefined)
      delete process.env.VISITOR_QR_SIGNING_SECRET;
    else process.env.VISITOR_QR_SIGNING_SECRET = previousVisitorSecret;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  }
});

test("existing 32+ character visitor QR secrets retain the original signature", () => {
  const previous = process.env.VISITOR_QR_SIGNING_SECRET;
  const secret = "test-only-visitor-qr-secret-that-is-long-enough";
  process.env.VISITOR_QR_SIGNING_SECRET = secret;

  try {
    const token = createLegacyVisitorQrToken({
      visitorId: "507f1f77bcf86cd799439011",
      qrId: "0b48636e-06e4-4f5e-b775-06dca1f6acdf",
      validFrom: new Date("2026-08-21T00:00:00.000Z"),
      expiresAt: new Date("2026-08-22T00:00:00.000Z"),
    });
    const [, body, signature] = token.split(".");
    const expected = require("crypto")
      .createHmac("sha256", secret)
      .update(body)
      .digest("base64url");

    assert.equal(signature, expected);
  } finally {
    if (previous === undefined) delete process.env.VISITOR_QR_SIGNING_SECRET;
    else process.env.VISITOR_QR_SIGNING_SECRET = previous;
  }
});
