#!/usr/bin/env node
/**
 * One-time, local bootstrap for a fresh Flowtix database.
 * Password is read from stdin so it is never embedded in a command line or package.
 * Refuses to modify a database that already has an active administrator.
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

function parseArgs(argv) {
  const out = { email: "", name: "Administrator" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--email") out.email = String(argv[++i] || "").trim().toLowerCase();
    else if (argv[i] === "--name") out.name = String(argv[++i] || "").trim();
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new Error("--email must be a valid email address.");
  if (!out.name) throw new Error("--name cannot be empty.");
  return out;
}

function runtimeLayout() {
  const repoBackend = path.resolve(__dirname, "..", "backend");
  const releaseHome = path.resolve(__dirname, "..");
  const appDir = fs.existsSync(path.join(releaseHome, "app", "package.json"))
    ? path.join(releaseHome, "app")
    : repoBackend;
  const requireFromApp = createRequire(path.join(appDir, "package.json"));
  const clientPath = fs.existsSync(path.join(appDir, "prisma", "generated", "client-v2"))
    ? path.join(appDir, "prisma", "generated", "client-v2")
    : path.join(repoBackend, "prisma", "generated", "client-v2");
  return { releaseHome, appDir, requireFromApp, clientPath };
}

async function createInitialAdmin({ prisma, bcrypt, email, name, password }) {
  if (password.length < 12) throw new Error("Initial password must be at least 12 characters.");
  const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
  if (activeAdmins > 0) throw new Error("An active administrator already exists; no users were changed.");
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new Error("That email already exists; no users were changed.");
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.create({
    data: { email, name, role: "ADMIN", isActive: true, passwordHash },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const layout = runtimeLayout();
  const dotenv = layout.requireFromApp("dotenv");
  dotenv.config({ path: path.join(layout.releaseHome, "shared", ".env"), override: false, quiet: true });
  dotenv.config({ path: path.join(layout.appDir, ".env"), override: false, quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured in shared/.env.");
  const password = fs.readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  if (!password) throw new Error("Provide the initial password on stdin.");
  const bcrypt = layout.requireFromApp("bcryptjs");
  const { PrismaClient } = require(layout.clientPath);
  const prisma = new PrismaClient();
  try {
    const user = await createInitialAdmin({ prisma, bcrypt, ...args, password });
    console.log(`Created active ${user.role} user ${user.email} (id=${user.id}).`);
    console.log("No operational users or passwords were created automatically.");
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[create-initial-admin] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, createInitialAdmin };
