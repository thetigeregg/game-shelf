const SINGLE_LINE_CONSOLE_INSTALLED = Symbol.for('game-shelf.singleLineConsole.installed');

function sanitizeLineBreaks(value: unknown): string {
  return String(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function normalizeError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause,
  };
}

function createReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet();

  return (_key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (value instanceof Error) {
      return normalizeError(value);
    }

    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }

    return value;
  };
}

function formatLogArgument(value: unknown): string {
  if (typeof value === 'string') {
    return sanitizeLineBreaks(value);
  }

  if (value instanceof Error) {
    return JSON.stringify(normalizeError(value), createReplacer());
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return String(value);
  }

  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return sanitizeLineBreaks(value);
  }

  try {
    return JSON.stringify(value, createReplacer());
  } catch {
    return sanitizeLineBreaks(value);
  }
}

export function formatSingleLineLogMessage(args: unknown[]): string {
  if (args.length === 0) {
    return '';
  }

  return args.map((value) => formatLogArgument(value)).join(' ');
}

type ConsoleMethodName = 'debug' | 'info' | 'log' | 'warn' | 'error';
type SingleLineConsole = Console & {
  [SINGLE_LINE_CONSOLE_INSTALLED]?: boolean;
};

export function installSingleLineConsole(consoleObject: Console = console): Console {
  const target = consoleObject as SingleLineConsole;

  if (target[SINGLE_LINE_CONSOLE_INSTALLED]) {
    return consoleObject;
  }

  const levels: ConsoleMethodName[] = ['debug', 'info', 'log', 'warn', 'error'];

  for (const level of levels) {
    const original = consoleObject[level].bind(consoleObject);

    consoleObject[level] = (...args: unknown[]) => {
      original(formatSingleLineLogMessage(args));
    };
  }

  Object.defineProperty(target, SINGLE_LINE_CONSOLE_INSTALLED, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return consoleObject;
}
