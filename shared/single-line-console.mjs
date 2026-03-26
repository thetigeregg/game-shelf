const SINGLE_LINE_CONSOLE_INSTALLED = Symbol.for('game-shelf.singleLineConsole.installed');

function sanitizeLineBreaks(value) {
  return String(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function normalizeError(error) {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause,
  };
}

function createReplacer() {
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

function formatLogArgument(value) {
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

export function formatSingleLineLogMessage(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return '';
  }

  return args.map((value) => formatLogArgument(value)).join(' ');
}

export function installSingleLineConsole(consoleObject = console) {
  if (consoleObject[SINGLE_LINE_CONSOLE_INSTALLED]) {
    return consoleObject;
  }

  const levels = ['debug', 'info', 'log', 'warn', 'error'];

  for (const level of levels) {
    const original = consoleObject[level];

    if (typeof original !== 'function') {
      continue;
    }

    consoleObject[level] = (...args) =>
      original.call(consoleObject, formatSingleLineLogMessage(args));
  }

  Object.defineProperty(consoleObject, SINGLE_LINE_CONSOLE_INSTALLED, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return consoleObject;
}
