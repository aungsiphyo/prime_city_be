const Knowledge = require("../models/Knowledge");
const { recordAdminAudit } = require("../services/audit.service");

function getUserId(user) {
  return user?.id || user?._id || null;
}

const CATEGORY_VALUES = Knowledge.CATEGORY_VALUES;
const AUDIENCE_VALUES = Knowledge.AUDIENCE_VALUES;
const MANAGER_ROLES = new Set(["Admin", "Staff"]);

function isManager(user) {
  return MANAGER_ROLES.has(user?.role);
}

function normalizeAudience(value) {
  const audience = String(value || "").trim().toLowerCase();

  if (audience === "citizen") return "resident";

  return audience;
}

function parseTags(tags) {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") return true;
  if (normalized === "false") return false;

  return undefined;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getReadableAudiences(user) {
  if (user?.role === "Admin") return AUDIENCE_VALUES;
  if (user?.role === "Staff") return ["staff", "all"];
  if (user?.role === "Security") return ["security", "all"];

  return ["resident", "user", "all"];
}

function buildPayload(body, { partial = false } = {}) {
  const errors = [];
  const payload = {};

  if (!partial || body.title != null) {
    const title = String(body.title || "").trim();

    if (!title) errors.push("title is required");
    else payload.title = title;
  }

  if (!partial || body.content != null) {
    const content = String(body.content || "").trim();

    if (!content) errors.push("content is required");
    else payload.content = content;
  }

  if (body.category != null) {
    const category = String(body.category).trim().toLowerCase();

    if (!CATEGORY_VALUES.includes(category)) {
      errors.push(`category must be one of: ${CATEGORY_VALUES.join(", ")}`);
    } else {
      payload.category = category;
    }
  }

  if (body.audience != null) {
    const audience = normalizeAudience(body.audience);

    if (!AUDIENCE_VALUES.includes(audience)) {
      errors.push(`audience must be one of: ${AUDIENCE_VALUES.join(", ")}`);
    } else {
      payload.audience = audience;
    }
  }

  if (body.tags != null) {
    payload.tags = parseTags(body.tags);
  }

  if (body.isActive != null) {
    const isActive = parseBoolean(body.isActive);

    if (isActive == null) {
      errors.push("isActive must be true or false");
    } else {
      payload.isActive = isActive;
    }
  }

  return { errors, payload };
}

function buildListFilter(req) {
  const filter = {};
  const readableAudiences = getReadableAudiences(req.user);
  const requestedAudience = req.query.audience
    ? normalizeAudience(req.query.audience)
    : null;

  if (req.query.category) {
    const category = String(req.query.category).trim().toLowerCase();

    if (CATEGORY_VALUES.includes(category)) {
      filter.category = category;
    }
  }

  if (isManager(req.user)) {
    const active = parseBoolean(req.query.active);

    if (active != null) filter.isActive = active;

    if (requestedAudience && AUDIENCE_VALUES.includes(requestedAudience)) {
      filter.audience = requestedAudience;
    }
  } else {
    filter.isActive = true;
    filter.audience = requestedAudience
      ? readableAudiences.includes(requestedAudience)
        ? requestedAudience
        : "__not_allowed__"
      : { $in: readableAudiences };
  }

  return filter;
}

async function listKnowledge(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const skip = (page - 1) * limit;
  const q = String(req.query.q || "").trim();
  const baseFilter = buildListFilter(req);

  try {
    let filter = { ...baseFilter };
    let projection = {};
    let sort = { updatedAt: -1 };

    if (q) {
      filter.$text = { $search: q };
      projection = { score: { $meta: "textScore" } };
      sort = { score: { $meta: "textScore" }, updatedAt: -1 };
    }

    let [items, total] = await Promise.all([
      Knowledge.find(filter, projection).sort(sort).skip(skip).limit(limit).lean(),
      Knowledge.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    if (!q) {
      return res.status(500).json({ success: false, message: err.message });
    }

    const regex = new RegExp(escapeRegex(q), "i");
    const filter = {
      ...baseFilter,
      $or: [{ title: regex }, { content: regex }, { tags: regex }],
    };

    try {
      const [items, total] = await Promise.all([
        Knowledge.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
        Knowledge.countDocuments(filter),
      ]);

      return res.json({
        success: true,
        data: items,
        pagination: {
          total,
          page,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (fallbackErr) {
      return res
        .status(500)
        .json({ success: false, message: fallbackErr.message });
    }
  }
}

async function createKnowledge(req, res) {
  const { errors, payload } = buildPayload(req.body);

  if (errors.length) {
    return res.status(400).json({
      success: false,
      message: errors.join("; "),
    });
  }

  try {
    const doc = await Knowledge.create(payload);
    await recordAdminAudit({
      adminUserId: getUserId(req.user),
      action: "knowledge_created",
      entityType: "Knowledge",
      entityId: doc._id,
      metadata: { category: doc.category, audience: doc.audience },
    });

    return res.status(201).json({
      success: true,
      data: doc,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

async function updateKnowledge(req, res) {
  const { errors, payload } = buildPayload(req.body, { partial: true });

  if (errors.length) {
    return res.status(400).json({
      success: false,
      message: errors.join("; "),
    });
  }

  try {
    const doc = await Knowledge.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Knowledge item not found",
      });
    }

    await recordAdminAudit({
      adminUserId: getUserId(req.user),
      action: "knowledge_updated",
      entityType: "Knowledge",
      entityId: doc._id,
      metadata: { category: doc.category, audience: doc.audience },
    });

    return res.json({
      success: true,
      data: doc,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

async function deleteKnowledge(req, res) {
  try {
    const doc = await Knowledge.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Knowledge item not found",
      });
    }

    await recordAdminAudit({
      adminUserId: getUserId(req.user),
      action: "knowledge_deactivated",
      entityType: "Knowledge",
      entityId: doc._id,
    });

    return res.json({
      success: true,
      message: "Knowledge item deactivated",
      data: doc,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

module.exports = {
  listKnowledge,
  createKnowledge,
  updateKnowledge,
  deleteKnowledge,
};
