import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const originalEnvKeys = new Set(Object.keys(process.env));

loadEnvFiles();

export function loadEnvFiles(root = process.cwd()) {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = join(root, fileName);
    if (!existsSync(filePath)) continue;

    const values = parseEnvFile(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (originalEnvKeys.has(key)) continue;
      process.env[key] = value;
    }
  }
}

export function parseEnvFile(raw) {
  const values = {};
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (parsed) values[parsed.key] = parsed.value;
  }

  return values;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;

  const source = trimmed.startsWith("export ") ? trimmed.slice(7).trimStart() : trimmed;
  const equalsIndex = source.indexOf("=");
  if (equalsIndex <= 0) return undefined;

  const key = source.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;

  const rawValue = source.slice(equalsIndex + 1).trim();
  return { key, value: parseEnvValue(rawValue) };
}

function parseEnvValue(value) {
  if (!value) return "";

  if (value.startsWith('"')) {
    const quoted = readQuotedValue(value, '"');
    return quoted
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }

  if (value.startsWith("'")) {
    return readQuotedValue(value, "'");
  }

  return stripInlineComment(value).trim();
}

function readQuotedValue(value, quote) {
  let escaped = false;
  let output = "";

  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (!escaped && char === quote) break;
    output += char;
    escaped = !escaped && char === "\\";
    if (escaped && char !== "\\") escaped = false;
  }

  return output;
}

function stripInlineComment(value) {
  const match = value.match(/\s+#/);
  if (!match?.index) return value;
  return value.slice(0, match.index);
}
