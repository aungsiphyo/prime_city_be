const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getAuthenticatedRole,
  getReviewerAccessConfig,
  isReviewerEmail,
  isReviewerOtp,
  isReviewerPassword,
} = require("../src/utils/reviewerAccess");

test("reviewer access has the Prime City review defaults", () => {
  assert.deepEqual(getReviewerAccessConfig({}), {
    email: "reviewer@primecity.com",
    password: "PrimeCityReviewer2026!",
    otp: "123456",
  });
});

test("all reviewer credentials must be configured together", () => {
  assert.throws(
    () =>
      getReviewerAccessConfig({
        GOOGLE_PLAY_REVIEWER_EMAIL: "reviewer@primecity.com",
      }),
    /must be configured together/,
  );
});

test("reviewer OTP must contain exactly six digits", () => {
  assert.throws(
    () =>
      getReviewerAccessConfig({
        GOOGLE_PLAY_REVIEWER_EMAIL: "reviewer@primecity.com",
        GOOGLE_PLAY_REVIEWER_PASSWORD: "PrimeCityReviewer2026!",
        GOOGLE_PLAY_REVIEWER_OTP: "12345x",
      }),
    /exactly 6 digits/,
  );
});

test("reviewer email comparison is trimmed and case-insensitive", () => {
  const config = getReviewerAccessConfig({
    GOOGLE_PLAY_REVIEWER_EMAIL: "reviewer@primecity.com",
    GOOGLE_PLAY_REVIEWER_PASSWORD: "PrimeCityReviewer2026!",
    GOOGLE_PLAY_REVIEWER_OTP: "123456",
  });

  assert.equal(isReviewerEmail(" REVIEWER@PrimeCity.com ", config), true);
  assert.equal(isReviewerEmail("resident@primecity.com", config), false);
});

test("reusable OTP is accepted only for the configured reviewer account", () => {
  const config = getReviewerAccessConfig({
    GOOGLE_PLAY_REVIEWER_EMAIL: "reviewer@primecity.com",
    GOOGLE_PLAY_REVIEWER_PASSWORD: "PrimeCityReviewer2026!",
    GOOGLE_PLAY_REVIEWER_OTP: "123456",
  });

  assert.equal(isReviewerOtp("reviewer@primecity.com", "123456", config), true);
  assert.equal(isReviewerOtp("reviewer@primecity.com", 123456, config), true);
  assert.equal(isReviewerOtp("reviewer@primecity.com", "654321", config), false);
  assert.equal(isReviewerOtp("resident@primecity.com", "123456", config), false);
});

test("reusable password is accepted only for the configured reviewer account", () => {
  const config = getReviewerAccessConfig({
    GOOGLE_PLAY_REVIEWER_EMAIL: "reviewer@primecity.com",
    GOOGLE_PLAY_REVIEWER_PASSWORD: "PrimeCityReviewer2026!",
    GOOGLE_PLAY_REVIEWER_OTP: "123456",
  });

  assert.equal(
    isReviewerPassword(
      "reviewer@primecity.com",
      "PrimeCityReviewer2026!",
      config,
    ),
    true,
  );
  assert.equal(
    isReviewerPassword("reviewer@primecity.com", "wrong-password", config),
    false,
  );
  assert.equal(
    isReviewerPassword(
      "resident@primecity.com",
      "PrimeCityReviewer2026!",
      config,
    ),
    false,
  );
});

test("reviewer authentication preserves the database role", () => {
  assert.equal(
    getAuthenticatedRole({
      email: "reviewer@primecity.com",
      role: "Resident",
    }),
    "Resident",
  );
  assert.equal(
    getAuthenticatedRole({
      email: "admin@primecity.com",
      role: "Admin",
    }),
    "Admin",
  );
});
