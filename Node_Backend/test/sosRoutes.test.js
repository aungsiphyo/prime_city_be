const assert = require("node:assert/strict");
const test = require("node:test");
const Notification = require("../src/models/Notification");
const SosAlert = require("../src/models/SosAlert");
const sosRouter = require("../src/routes/sos");

function findRoute(method, path) {
  return sosRouter.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  );
}

function assertProtected(method, path) {
  const layer = findRoute(method, path);
  assert.ok(layer, `${method.toUpperCase()} ${path} must exist`);
  assert.equal(layer.route.stack[0].handle.name, "protect");
  return layer;
}

test("SOS review, broadcast and mutation routes require authentication", () => {
  assertProtected("get", "/");
  assertProtected("get", "/:id");
  assertProtected("post", "/");
  assertProtected("post", "/emergency");
  assertProtected("post", "/:id/approve");
  assertProtected("post", "/:id/reject");
  assertProtected("post", "/:id/broadcast");
  assertProtected("put", "/:id");
  assertProtected("delete", "/:id");
});

test("resident cannot invoke an Admin-only SOS approval", () => {
  const approvalRoute = findRoute("post", "/:id/approve");
  let statusCode = null;

  approvalRoute.route.stack[1].handle(
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
    () => assert.fail("Resident must not reach the SOS approval handler"),
  );

  assert.equal(statusCode, 403);
});

test("SOS and notification schemas persist review and delivery state", () => {
  const statusPath = SosAlert.schema.path("status");
  assert.ok(statusPath.enumValues.includes("Approved"));
  assert.ok(SosAlert.schema.path("approved_at"));
  assert.ok(SosAlert.schema.path("approved_by"));
  assert.ok(SosAlert.schema.path("broadcast_status"));
  assert.ok(SosAlert.schema.path("push_delivery"));
  assert.ok(Notification.schema.path("dedupe_key"));
});
