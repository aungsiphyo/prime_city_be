const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PUSH_CHANNELS,
  buildMessage,
} = require("../src/services/push.service");

test("Android push uses an audible high-priority private channel", () => {
  const message = buildMessage(
    ["device-token"],
    { title: "Prime City", message: "Account update", type: "General" },
    { channelId: "community_updates" },
  );

  assert.equal(message.android.priority, "high");
  assert.equal(message.android.notification.channelId, PUSH_CHANNELS.community);
  assert.equal(message.android.notification.sound, "default");
  assert.equal(message.android.notification.defaultSound, true);
  assert.equal(message.android.notification.defaultVibrateTimings, true);
  assert.equal(message.android.notification.visibility, "private");
  assert.equal(message.data.channel_id, PUSH_CHANNELS.community);
});
