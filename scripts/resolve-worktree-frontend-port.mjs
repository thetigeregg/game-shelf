import { createWorktreeContext, loadDevxConfig } from '@thetigeregg/dev-cli';

export function parseWorktreeFrontendPortOutput(output) {
  const raw = output.trim();
  const port = Number(raw);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `Invalid worktree FRONTEND_PORT ${JSON.stringify(raw)}. Expected a positive integer from resolve-worktree-frontend-port.mjs.`
    );
  }

  return port;
}

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
