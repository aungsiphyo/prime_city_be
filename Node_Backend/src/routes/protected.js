const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const User = require("../models/User");
const { resolveCurrentRoom } = require("../services/aiTools.service");

const PROFILE_IMAGE_DIRECTORY = path.resolve(
  __dirname,
  "../../public/uploads/profile-images"
);
const PROFILE_IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

fs.mkdirSync(PROFILE_IMAGE_DIRECTORY, { recursive: true });

const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!PROFILE_IMAGE_TYPES.has(file.mimetype)) {
      return callback(new Error("Only JPEG, PNG, or WebP images are allowed"));
    }
    return callback(null, true);
  },
});

function detectProfileImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return ".jpg";
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return ".png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return ".webp";
  }
  return null;
}

function receiveProfileImage(req, res, next) {
  profileImageUpload.single("profile_image")(req, res, (err) => {
    if (!err) return next();

    const isTooLarge =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
    return res.status(isTooLarge ? 413 : 400).json({
      success: false,
      message: isTooLarge
        ? "Profile image must be 5 MB or smaller"
        : err.message || "Invalid profile image",
    });
  });
}

function getPublicOrigin(req) {
  const configuredOrigin = String(process.env.PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  if (configuredOrigin) return configuredOrigin;

  const forwardedProtocol = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  return `${forwardedProtocol || req.protocol || "http"}://${req.get("host")}`;
}

router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "-password -otp -otpExpires -otpPurpose -refreshTokens"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const resolvedRoom = await resolveCurrentRoom(user);

    res.json({
      message: "Profile access granted",
      user: {
        id: user._id,
        resident_uid: user.resident_uid || null,
        rfid_uid: user.rfid_uid || null,
        fullname: user.fullname,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profile_image: user.profile_image || null,
        room_id: user.room_id || null,
        room_number: resolvedRoom.room?.room_name || null,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/profile/image", protect, receiveProfileImage, async (req, res) => {
  let savedImagePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select a profile image",
      });
    }

    const detectedExtension = detectProfileImageExtension(req.file.buffer);
    const declaredExtension = PROFILE_IMAGE_TYPES.get(req.file.mimetype);
    if (!detectedExtension || detectedExtension !== declaredExtension) {
      return res.status(400).json({
        success: false,
        message: "The selected file is not a valid JPEG, PNG, or WebP image",
      });
    }

    const userId = String(req.user?.id || req.user?._id);
    const filename = `${userId}-${Date.now()}-${crypto.randomUUID()}${detectedExtension}`;
    savedImagePath = path.join(PROFILE_IMAGE_DIRECTORY, filename);
    await fs.promises.writeFile(savedImagePath, req.file.buffer, {
      flag: "wx",
    });

    const relativePath = `/uploads/profile-images/${filename}`;
    const profileImageUrl = `${getPublicOrigin(req)}${relativePath}`;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { profile_image: profileImageUrl } },
      {
        new: true,
        runValidators: true,
        select:
          "_id fullname email phone role room_id profile_image created_at resident_uid rfid_uid",
      }
    );

    if (!user) {
      await fs.promises.unlink(savedImagePath).catch(() => null);
      savedImagePath = null;
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      message: "Profile image updated",
      profile_image: user.profile_image,
      user,
    });
  } catch (err) {
    if (savedImagePath) {
      await fs.promises.unlink(savedImagePath).catch(() => null);
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/admin", protect, authorizeRoles("Admin"), (req, res) => {
  res.json({ message: "Welcome Admin" });
});

router.get("/staff", protect, authorizeRoles("Staff", "Admin"), (req, res) => {
  res.json({ message: "Welcome Staff/Admin" });
});

module.exports = router;
