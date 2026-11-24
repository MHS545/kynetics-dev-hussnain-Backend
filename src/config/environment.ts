const requiredEnvironment = ["DB_PASSWORD"] as const;
export function missingEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return requiredEnvironment.filter((key) => !env[key]?.trim());
}
export function publicConfiguration() {
  return { configured: missingEnvironment().length === 0 };
}
// Staff roles always come from database grants. This local build has no demo-owner bypass.
export function canPreviewRoles() {
  return false;
}
