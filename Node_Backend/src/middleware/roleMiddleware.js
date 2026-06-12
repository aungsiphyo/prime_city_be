const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Role (${req.user.role}) not allowed`,
      });
    }

    next();
  };
};

module.exports = authorizeRoles;
