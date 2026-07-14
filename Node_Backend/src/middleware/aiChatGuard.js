function numberEnv(name, fallback, { min = Number.NEGATIVE_INFINITY } = {}) {
  const value = Number(process.env[name]);

  if (Number.isFinite(value) && value >= min) return value;

  return fallback;
}

const WINDOW_MS = numberEnv("AI_RATE_LIMIT_WINDOW_MS", 60_000, { min: 1000 });
const MAX_REQUESTS = numberEnv("AI_RATE_LIMIT_MAX", 30, { min: 1 });
const buckets = new Map();

function getClientKey(req) {
  return req.user?.id || req.ip || req.headers["x-forwarded-for"] || "unknown";
}

function aiRateLimit(req, res, next) {
  if (process.env.AI_RATE_LIMIT_ENABLED === "false") {
    return next();
  }

  const now = Date.now();
  const key = getClientKey(req);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  bucket.count += 1;

  if (bucket.count > MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      message: "AI chat request limit reached. Please wait and try again.",
    });
  }

  return next();
}

function requireAIAuthIfConfigured(req, res, next) {
  if (process.env.AI_REQUIRE_AUTH === "true" && !req.user?.id) {
    return res.status(401).json({
      success: false,
      message: "Login required to use AI chat",
    });
  }

  return next();
}

module.exports = {
  aiRateLimit,
  requireAIAuthIfConfigured,
};
