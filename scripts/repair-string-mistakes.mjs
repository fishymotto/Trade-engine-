import fs from "node:fs";
import path from "node:path";

const appData = process.env.APPDATA;

if (!appData) {
  throw new Error("APPDATA is not set.");
}

const baseDir = path.join(appData, "com.tradeengine.desktop");
const sessionsPath = path.join(baseDir, "trade-sessions.json");
const overridesPath = path.join(baseDir, "trade-tag-overrides.json");

const normalizeRows = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object" && Array.isArray(value.value)) {
    return value.value;
  }

  return value ? [value] : [];
};

const normalizeStringList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
};

const backupDir = path.resolve("exports");
fs.mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

const sessionsBackupPath = path.join(
  backupDir,
  `trade-sessions.before-mistake-shape-repair-node-${timestamp}.json`
);
const overridesBackupPath = path.join(
  backupDir,
  `trade-tag-overrides.before-mistake-shape-repair-node-${timestamp}.json`
);

fs.copyFileSync(sessionsPath, sessionsBackupPath);
fs.copyFileSync(overridesPath, overridesBackupPath);

const sessions = normalizeRows(JSON.parse(fs.readFileSync(sessionsPath, "utf8")));
const overrides = normalizeRows(JSON.parse(fs.readFileSync(overridesPath, "utf8")));

let sessionTradeFixes = 0;
for (const session of sessions) {
  for (const trade of session.trades ?? []) {
    if (typeof trade.mistakes === "string") {
      trade.mistakes = normalizeStringList(trade.mistakes);
      sessionTradeFixes += 1;
    }
  }
}

let overrideFixes = 0;
for (const override of overrides) {
  if (typeof override.mistakes === "string") {
    const normalizedMistakes = normalizeStringList(override.mistakes);
    override.mistakes = normalizedMistakes;
    override.mistake = normalizedMistakes[0] ?? override.mistake ?? null;
    overrideFixes += 1;
  }
}

fs.writeFileSync(sessionsPath, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
fs.writeFileSync(overridesPath, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");

console.log("Repaired string-shaped mistake tags with Node.");
console.log(`session_trade_fixes=${sessionTradeFixes}`);
console.log(`override_fixes=${overrideFixes}`);
console.log(`sessions_backup=${sessionsBackupPath}`);
console.log(`overrides_backup=${overridesBackupPath}`);
