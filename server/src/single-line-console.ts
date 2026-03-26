import * as sharedSingleLineConsoleModule from '../../shared/single-line-console.mjs';

type SharedSingleLineConsoleModule = {
  formatSingleLineLogMessage: (level: string, args: unknown[] | null) => string;
  installSingleLineConsole: (consoleObject?: Console) => Console;
};

const { formatSingleLineLogMessage: formatSingleLineLogMessageShared } =
  sharedSingleLineConsoleModule as SharedSingleLineConsoleModule;
const { installSingleLineConsole: installSingleLineConsoleShared } =
  sharedSingleLineConsoleModule as SharedSingleLineConsoleModule;

export function formatSingleLineLogMessage(level: string, args: unknown[] = []): string {
  return formatSingleLineLogMessageShared(level, args);
}

export function installSingleLineConsole(consoleObject: Console = console): Console {
  return installSingleLineConsoleShared(consoleObject);
}
