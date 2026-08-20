import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALE_FILE = /^([a-z]{2}(?:_[A-Z]{2})?)\.yml$/;

export function sourceLocaleCodes(localesDir) {
  return readdirSync(localesDir)
    .map((file) => file.match(LOCALE_FILE)?.[1])
    .filter((code) => code !== undefined)
    .sort();
}

export function builtLocaleCodes(buildDir) {
  const directory = resolve(buildDir, "_locales");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const messages = resolve(directory, entry.name, "messages.json");
      if (!existsSync(messages)) {
        throw new Error(`${entry.name} has no _locales/${entry.name}/messages.json`);
      }
      return entry.name;
    })
    .sort();
}

export function assertBuiltLocaleCodes(localesDir, buildDir) {
  const expected = sourceLocaleCodes(localesDir);
  const actual = builtLocaleCodes(buildDir);
  const missing = expected.filter((code) => !actual.includes(code));
  const extra = actual.filter((code) => !expected.includes(code));
  if (missing.length || extra.length) {
    const details = [
      missing.length ? `missing: ${missing.join(", ")}` : null,
      extra.length ? `extra: ${extra.join(", ")}` : null,
    ].filter(Boolean).join("; ");
    throw new Error(`${buildDir} locale set differs from source (${details})`);
  }
  return actual;
}

function main(argv) {
  if (argv.length === 0) {
    throw new Error("usage: node scripts/assert-built-locales.mjs <build-dir> [build-dir...]");
  }
  const localesDir = resolve(import.meta.dirname, "../locales");
  for (const buildDir of argv) {
    const codes = assertBuiltLocaleCodes(localesDir, resolve(buildDir));
    console.log(`${buildDir}: ${codes.join(", ")}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
