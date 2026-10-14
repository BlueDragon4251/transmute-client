import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const i18nDir = path.resolve(__dirname, '../src/i18n');
const baseLocale = 'en';

function flattenKeys(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(nestedValue, nextPrefix);
  });
}

async function readLocaleFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

function formatGroup(label, keys) {
  if (keys.length === 0) {
    return null;
  }

  return [label, ...keys.map((key) => `  - ${key}`)].join('\n');
}

async function main() {
  const files = await readdir(i18nDir);
  const localeFiles = files
    .filter((file) => file.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

  const baseFile = `${baseLocale}.json`;
  if (!localeFiles.includes(baseFile)) {
    throw new Error(`Base locale file not found: ${baseFile}`);
  }

  const localeData = await Promise.all(
    localeFiles.map(async (file) => {
      const locale = path.basename(file, '.json');
      const data = await readLocaleFile(path.join(i18nDir, file));
      return { locale, keys: new Set(flattenKeys(data).sort()) };
    }),
  );

  const baseKeys = localeData.find(({ locale }) => locale === baseLocale)?.keys;
  if (!baseKeys) {
    throw new Error(`Failed to load base locale: ${baseLocale}`);
  }

  const mismatches = localeData
    .filter(({ locale }) => locale !== baseLocale)
    .map(({ locale, keys }) => {
      const missing = [...baseKeys].filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !baseKeys.has(key) && !(/_(zero|one|two|few|many|other)$/.test(key) && [...baseKeys].some(base => base.replace(/_(zero|one|two|few|many|other)$/, '') === key.replace(/_(zero|one|two|few|many|other)$/, ''))));
      return { locale, missing, extra };
    })
    .filter(({ missing, extra }) => missing.length > 0 || extra.length > 0);

  if (mismatches.length === 0) {
    console.log(`i18n keys match ${baseFile} across ${localeFiles.length - 1} locale file(s).`);
    return;
  }

  console.error(`Found i18n key mismatches against ${baseFile}:`);
  for (const mismatch of mismatches) {
    const sections = [
      formatGroup('missing keys:', mismatch.missing),
      formatGroup('extra keys:', mismatch.extra),
    ].filter(Boolean);

    console.error(`\n${mismatch.locale}.json`);
    console.error(sections.join('\n'));
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});