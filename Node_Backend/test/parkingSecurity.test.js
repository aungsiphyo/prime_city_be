const assert = require("node:assert/strict");
const test = require("node:test");
const parkingRouter = require("../src/routes/parking");

test("parking mutation and raw history routes require authentication", () => {
  const protectedPaths = [
    "/setup",
    "/events/history",
    "/:type/delta",
    "/:type/reset",
  ];

  for (const path of protectedPaths) {
    const layer = parkingRouter.stack.find((item) => item.route?.path === path);
    assert.ok(layer, `${path} route must exist`);
    assert.equal(layer.route.stack[0].handle.name, "protect");

    let statusCode = null;
    let body = null;
    let nextCalled = false;
    layer.route.stack[0].handle(
      { headers: {} },
      {
        status(value) {
          statusCode = value;
          return this;
        },
        json(value) {
          body = value;
          return this;
        },
      },
      () => {
        nextCalled = true;
      },
    );
    assert.equal(statusCode, 401);
    assert.equal(body.message, "No token, access denied");
    assert.equal(nextCalled, false);
  }
});
