const assert = require("node:assert/strict");
const test = require("node:test");
const playgroundRouter = require("../src/routes/playground");
const rfidWalletRouter = require("../src/routes/rfidWallet");
const {
  getHelperCatalog,
  getHelperPriceSnapshot,
  getPlaygroundConfig,
} = require("../src/services/communityCatalog.service");

function findRoute(router, method, path) {
  return router.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method]
  );
}

function assertProtected(layer) {
  assert.ok(layer, "route must exist");
  assert.equal(layer.route.stack[0].handle.name, "protect");
}

test("Cleaning helper price and schedule match the published resident rate", () => {
  const cleaning = getHelperCatalog().find((item) => item.name === "Cleaning");
  assert.deepEqual(cleaning, {
    name: "Cleaning",
    currency: "MMK",
    amount_mmk: 30000,
    service_window: "9:00 AM - 12:00 PM",
    pricing_status: "Fixed",
  });
  assert.deepEqual(getHelperPriceSnapshot("Cleaning"), {
    quoted_price_mmk: 30000,
    quoted_currency: "MMK",
    service_window: "9:00 AM - 12:00 PM",
    pricing_status: "Fixed",
  });
});

test("unspecified helper prices require Admin confirmation instead of invented fees", () => {
  const cooking = getHelperPriceSnapshot("Cooking");
  assert.equal(cooking.quoted_price_mmk, null);
  assert.equal(cooking.pricing_status, "Admin Confirmation");
});

test("playground discount is calculated only from explicit environment configuration", () => {
  const previousFee = process.env.PLAYGROUND_BASE_FEE_MMK;
  const previousDiscount = process.env.PLAYGROUND_RESIDENT_DISCOUNT_PERCENT;
  process.env.PLAYGROUND_BASE_FEE_MMK = "20000";
  process.env.PLAYGROUND_RESIDENT_DISCOUNT_PERCENT = "25";

  try {
    const config = getPlaygroundConfig();
    assert.equal(config.pricing_configured, true);
    assert.equal(config.base_fee_mmk, 20000);
    assert.equal(config.resident_discount_percent, 25);
    assert.equal(config.discounted_fee_mmk, 15000);
  } finally {
    if (previousFee === undefined) delete process.env.PLAYGROUND_BASE_FEE_MMK;
    else process.env.PLAYGROUND_BASE_FEE_MMK = previousFee;
    if (previousDiscount === undefined) {
      delete process.env.PLAYGROUND_RESIDENT_DISCOUNT_PERCENT;
    } else {
      process.env.PLAYGROUND_RESIDENT_DISCOUNT_PERCENT = previousDiscount;
    }
  }
});

test("RFID wallet and playground records require authenticated access", () => {
  assertProtected(findRoute(rfidWalletRouter, "get", "/me"));
  assertProtected(findRoute(rfidWalletRouter, "get", "/merchants"));
  assertProtected(findRoute(rfidWalletRouter, "post", "/pay"));
  assertProtected(findRoute(rfidWalletRouter, "post", "/merchants"));
  assertProtected(findRoute(rfidWalletRouter, "post", "/merchants/:id/settle"));
  assertProtected(findRoute(rfidWalletRouter, "get", "/merchants/:id/ledger"));
  assertProtected(findRoute(rfidWalletRouter, "post", "/adjust"));
  assertProtected(findRoute(playgroundRouter, "get", "/config"));
  assertProtected(findRoute(playgroundRouter, "get", "/registrations"));
  assertProtected(findRoute(playgroundRouter, "post", "/registrations"));
  assertProtected(
    findRoute(playgroundRouter, "patch", "/registrations/:id/status")
  );
});

test("RFID balance adjustments and playground status changes are manager-only", () => {
  const walletAdjustment = findRoute(rfidWalletRouter, "post", "/adjust");
  const playgroundStatus = findRoute(
    playgroundRouter,
    "patch",
    "/registrations/:id/status"
  );
  assert.equal(walletAdjustment.route.stack[1].handle.name, "");
  assert.equal(playgroundStatus.route.stack[1].handle.name, "");

  for (const layer of [walletAdjustment, playgroundStatus]) {
    let statusCode = null;
    layer.route.stack[1].handle(
      { user: { role: "Resident" } },
      {
        status(value) {
          statusCode = value;
          return this;
        },
        json() {
          return this;
        },
      },
      () => assert.fail("Resident must not reach a manager-only route")
    );
    assert.equal(statusCode, 403);
  }
});

test("resident can pay but cannot create or settle Prime City merchants", () => {
  const payment = findRoute(rfidWalletRouter, "post", "/pay");
  const createMerchant = findRoute(rfidWalletRouter, "post", "/merchants");
  const settleMerchant = findRoute(
    rfidWalletRouter,
    "post",
    "/merchants/:id/settle"
  );
  const merchantLedger = findRoute(
    rfidWalletRouter,
    "get",
    "/merchants/:id/ledger"
  );
  assert.equal(payment.route.stack[1].handle.name, "");

  for (const layer of [createMerchant, settleMerchant, merchantLedger]) {
    let statusCode = null;
    layer.route.stack[1].handle(
      { user: { role: "Resident" } },
      {
        status(value) {
          statusCode = value;
          return this;
        },
        json() {
          return this;
        },
      },
      () => assert.fail("Resident must not manage merchant ledgers")
    );
    assert.equal(statusCode, 403);
  }
});
