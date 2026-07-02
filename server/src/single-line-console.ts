import {
  formatSingleLineLogMessage as formatSingleLineLogMessageShared,
  installSingleLineConsole as installSingleLineConsoleShared,
} from '../../shared/single-line-console.mjs';

export function formatSingleLineLogMessage(level: string, args: unknown[] = []): string {
  return formatSingleLineLogMessageShared(level, args);
}

export function installSingleLineConsole(consoleObject: Console = console): Console {
  return installSingleLineConsoleShared(consoleObject);
}
