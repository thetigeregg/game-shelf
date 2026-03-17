export function parsePositiveEnvInt(name, fallbackValue, env = process.env) {
  const parsed = Number.parseInt(env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}
