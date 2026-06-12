import { createWorktreeContext, loadDevxConfig } from '@thetigeregg/dev-cli';

export async function resolveWorktreeFrontendPort({
  cwd = process.cwd(),
  processEnv = process.env,
} = {}) {
  const config = await loadDevxConfig({ cwd });
  const context = await createWorktreeContext({ cwd, config, processEnv });
  return context.runtime.ports.FRONTEND_PORT;
}

const isDirectExecution =
  process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;

if (isDirectExecution) {
  const port = await resolveWorktreeFrontendPort();
  process.stdout.write(String(port));
}
