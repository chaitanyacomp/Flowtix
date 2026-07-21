const { ERP_ROLES } = require("./erpRoles");

const ROLE_ACCESS = Object.freeze({
  ADMIN: Object.freeze({ landingPath: "/dashboard", permissions: Object.freeze(["dashboard:admin", "users:manage"]) }),
  STORE: Object.freeze({ landingPath: "/dashboard", permissions: Object.freeze(["dashboard:store", "stock:read", "stock:write"]) }),
  PURCHASE: Object.freeze({ landingPath: "/dashboard", permissions: Object.freeze(["dashboard:purchase", "purchase:read", "purchase:write"]) }),
  PRODUCTION: Object.freeze({ landingPath: "/dashboard", permissions: Object.freeze(["dashboard:production", "production:read", "production:write"]) }),
  QA: Object.freeze({ landingPath: "/dashboard", permissions: Object.freeze(["dashboard:qa", "quality:read", "quality:write"]) }),
});

function normalizeRole(role) {
  const normalized = String(role ?? "").trim().toUpperCase();
  return ERP_ROLES.includes(normalized) ? normalized : null;
}

function accessForRole(role) {
  const normalized = normalizeRole(role);
  if (!normalized) return null;
  const access = ROLE_ACCESS[normalized];
  return { role: normalized, landingPath: access.landingPath, permissions: [...access.permissions] };
}

module.exports = { ROLE_ACCESS, normalizeRole, accessForRole };
