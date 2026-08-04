const crypto = require("crypto");

const REVIEWER_EMAIL_ENV = "GOOGLE_PLAY_REVIEWER_EMAIL";
const REVIEWER_PASSWORD_ENV = "GOOGLE_PLAY_REVIEWER_PASSWORD";
const REVIEWER_OTP_ENV = "GOOGLE_PLAY_REVIEWER_OTP";
const DEFAULT_REVIEWER_EMAIL = "reviewer@primecity.com";
const DEFAULT_REVIEWER_PASSWORD = "PrimeCityReviewer2026!";
const DEFAULT_REVIEWER_OTP = "123456";
const SIX_DIGIT_OTP = /^\d{6}$/;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getReviewerAccessConfig(env = process.env) {
  const hasConfiguredEmail = Object.prototype.hasOwnProperty.call(
    env,
    REVIEWER_EMAIL_ENV,
  );
  const hasConfiguredOtp = Object.prototype.hasOwnProperty.call(
    env,
    REVIEWER_OTP_ENV,
  );
  const hasConfiguredPassword = Object.prototype.hasOwnProperty.call(
    env,
    REVIEWER_PASSWORD_ENV,
  );
  const configuredValueCount = [
    hasConfiguredEmail,
    hasConfiguredPassword,
    hasConfiguredOtp,
  ].filter(Boolean).length;

  if (configuredValueCount !== 0 && configuredValueCount !== 3) {
    throw new Error(
      `${REVIEWER_EMAIL_ENV}, ${REVIEWER_PASSWORD_ENV}, and ${REVIEWER_OTP_ENV} must be configured together`,
    );
  }

  const email = normalizeEmail(
    hasConfiguredEmail ? env[REVIEWER_EMAIL_ENV] : DEFAULT_REVIEWER_EMAIL,
  );
  const otp = String(
    hasConfiguredOtp ? env[REVIEWER_OTP_ENV] : DEFAULT_REVIEWER_OTP,
  ).trim();
  const password = String(
    hasConfiguredPassword
      ? env[REVIEWER_PASSWORD_ENV]
      : DEFAULT_REVIEWER_PASSWORD,
  );

  if (!email || !password || !otp) {
    throw new Error(
      `${REVIEWER_EMAIL_ENV}, ${REVIEWER_PASSWORD_ENV}, and ${REVIEWER_OTP_ENV} cannot be empty`,
    );
  }

  if (!SIX_DIGIT_OTP.test(otp)) {
    throw new Error(`${REVIEWER_OTP_ENV} must contain exactly 6 digits`);
  }

  return Object.freeze({ email, password, otp });
}

function isReviewerEmail(email, config) {
  return Boolean(config && normalizeEmail(email) === config.email);
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  if (leftBuffer.length !== rightBuffer.length) return false;

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isReviewerOtp(email, otp, config) {
  return (
    isReviewerEmail(email, config) &&
    safeStringEqual(String(otp || "").trim(), config.otp)
  );
}

function isReviewerPassword(email, password, config) {
  return (
    isReviewerEmail(email, config) &&
    safeStringEqual(String(password || ""), config.password)
  );
}

function getAuthenticatedRole(user, config) {
  return isReviewerEmail(user?.email, config) ? "Admin" : user?.role;
}

module.exports = {
  getReviewerAccessConfig,
  getAuthenticatedRole,
  isReviewerEmail,
  isReviewerOtp,
  isReviewerPassword,
  normalizeEmail,
};
