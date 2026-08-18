const assert = require("node:assert/strict");
const test = require("node:test");
const visitorRouter = require("../src/routes/visitor");
const {
  createVisitorQrToken,
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

test("visitor passes are signed, time-bound, and tamper-evident", () => {
  const previous = process.env.VISITOR_QR_SIGNING_SECRET;
  process.env.VISITOR_QR_SIGNING_SECRET =
    "test-only-visitor-qr-secret-that-is-long-enough";
  try {
    const now = new Date("2026-08-18T06:00:00.000Z");
    const token = createVisitorQrToken({
      visitorId: "507f1f77bcf86cd799439011",
      qrId: "d8b7635a-943c-43d8-9d65-9c3083613983",
      validFrom: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 60000),
    });
    const payload = verifyVisitorQrToken(token, now);
    assert.equal(payload.vid, "507f1f77bcf86cd799439011");
    assert.equal(payload.qid, "d8b7635a-943c-43d8-9d65-9c3083613983");
    assert.throws(
      () => verifyVisitorQrToken(`${token.slice(0, -1)}x`, now),
      /signature|Invalid visitor pass/
    );
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
    const now = new Date();
    const token = createVisitorQrToken({
      visitorId: "507f1f77bcf86cd799439011",
      qrId: "d8b7635a-943c-43d8-9d65-9c3083613983",
      validFrom: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 60000),
    });
    const image = await createVisitorQrImageDataUrl(token);
    assert.match(image, /^data:image\/png;base64,/);
    assert.ok(image.length > 1000);
  } finally {
    if (previous === undefined) delete process.env.VISITOR_QR_SIGNING_SECRET;
    else process.env.VISITOR_QR_SIGNING_SECRET = previous;
  }
});
