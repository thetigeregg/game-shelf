const SINGLE_LINE_CONSOLE_INSTALLED = Symbol.for('game-shelf.singleLineConsole.installed');
const EVENT_PREFIX_PATTERN = /^\[([^[\]]+)\]\s+(.+)$/;
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 5;
const TRUNCATED_SUFFIX = '...[truncated]';

function sanitizeLineBreaks(value: unknown): string {
  return String(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  const availableForContent = Math.max(0, MAX_STRING_LENGTH - TRUNCATED_SUFFIX.length);

  return `${value.slice(0, availableForContent)}${TRUNCATED_SUFFIX}`;
}

function sanitizeString(value: string): string {
  return truncateString(sanitizeLineBreaks(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    return Object.prototype.toString.call(value) === '[object Object]';
  } catch {
    return false;
  }
}

function createSafeRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function isErrorObject(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function stringifyNonPlainObject(value: object): string {
  let prototype: { toString?: () => string } | null;

  try {
    prototype = Object.getPrototypeOf(value) as { toString?: () => string } | null;
  } catch {
    prototype = null;
  }

  if (prototype?.toString !== undefined && prototype.toString !== Object.prototype.toString) {
    try {
      return prototype.toString.call(value);
    } catch {
      // Fall through to Object.prototype.toString or the final safe placeholder.
    }
  }

  try {
    return Object.prototype.toString.call(value);
  } catch {
    return '[object toString threw]';
  }
}

function normalizeUnknown(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0
): string | number | boolean | null | unknown[] | Record<string, unknown> {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'undefined') {
    return value ?? null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : sanitizeString(String(value));
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol' || typeof value === 'function') {
    return sanitizeString(String(value));
  }

  if (isErrorObject(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    try {
      return normalizeUnknown(
        {
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        },
        seen,
        depth + 1
      );
    } finally {
      seen.delete(value);
    }
  }

  if (typeof value !== 'object') {
    return sanitizeString(Object.prototype.toString.call(value));
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (depth >= MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[Array(${String(value.length)})]`;
    }

    return '[Object]';
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const normalizedItems = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => normalizeUnknown(item, seen, depth + 1));

      if (value.length > MAX_ARRAY_ITEMS) {
        normalizedItems.push(`[+${String(value.length - MAX_ARRAY_ITEMS)} more]`);
      }

      return normalizedItems;
    }

    if (!isPlainObject(value)) {
      return sanitizeString(stringifyNonPlainObject(value));
    }

    const objectValue: Record<string, unknown> = value;
    const normalized = createSafeRecord();
    let retainedKeyCount = 0;
    let omittedKeyCount = 0;

    for (const key in objectValue) {
      if (!Object.prototype.hasOwnProperty.call(objectValue, key)) {
        continue;
      }

      if (retainedKeyCount < MAX_OBJECT_KEYS) {
        normalized[key] = normalizeUnknown(objectValue[key], seen, depth + 1);
        retainedKeyCount += 1;
      } else {
        omittedKeyCount += 1;
      }
    }

    if (omittedKeyCount > 0) {
      normalized['__truncatedKeys'] = omittedKeyCount;
    }

    return normalized;
  } finally {
    seen.delete(value);
  }
}

function buildEnvelope(level: string, args: unknown[]): Record<string, unknown> {
  const payload = createSafeRecord();
  payload['ts'] = new Date().toISOString();
  payload['level'] = level;
  const normalizedArgs = args.map((value) => normalizeUnknown(value, new WeakSet()));
  const first = normalizedArgs[0];
  let argsStartIndex = 0;

  if (typeof first === 'string') {
    const eventMatch = first.match(EVENT_PREFIX_PATTERN);

    if (eventMatch) {
      payload['service'] = eventMatch[1];
      payload['event'] = eventMatch[2];
      argsStartIndex = 1;
    } else {
      payload['message'] = first;
      argsStartIndex = 1;
    }
  }

  const remainingArgs = normalizedArgs.slice(argsStartIndex);
  const [firstContext, ...otherArgs] = remainingArgs;

  if (isPlainObject(firstContext)) {
    for (const [key, value] of Object.entries(firstContext)) {
      if (!Object.hasOwn(payload, key)) {
        payload[key] = value;
      } else {
        otherArgs.unshift({ [key]: value });
      }
    }
  } else if (typeof firstContext !== 'undefined') {
    otherArgs.unshift(firstContext);
  }

  if (otherArgs.length > 0) {
    payload['args'] = otherArgs;
  }

  if (!('service' in payload)) {
    payload['service'] = 'app';
  }

  if (!('event' in payload) && !('message' in payload)) {
    payload['event'] = 'log';
  }

  return payload;
}

export function formatSingleLineLogMessage(level: string, args: unknown[]): string {
  if (args.length === 0) {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: 'app',
      event: 'log',
    });
  }

  return JSON.stringify(buildEnvelope(level, args));
}

type ConsoleMethodName = 'debug' | 'info' | 'log' | 'warn' | 'error' | 'trace' | 'dir' | 'table';
type ConsoleOutputMethodName = 'debug' | 'info' | 'log' | 'warn' | 'error';
type SingleLineConsole = Console & {
  [SINGLE_LINE_CONSOLE_INSTALLED]?: boolean;
};

export function installSingleLineConsole(consoleObject: Console = console): Console {
  const target = consoleObject as SingleLineConsole;

  if (target[SINGLE_LINE_CONSOLE_INSTALLED]) {
    return consoleObject;
  }

  const levels: ConsoleMethodName[] = [
    'debug',
    'info',
    'log',
    'warn',
    'error',
    'trace',
    'dir',
    'table',
  ];
  const originalMethods: Record<
    ConsoleOutputMethodName,
    ((message?: unknown, ...optionalParams: unknown[]) => void) | null
  > = {
    debug:
      typeof consoleObject.debug === 'function' ? consoleObject.debug.bind(consoleObject) : null,
    info: typeof consoleObject.info === 'function' ? consoleObject.info.bind(consoleObject) : null,
    log: typeof consoleObject.log === 'function' ? consoleObject.log.bind(consoleObject) : null,
    warn: typeof consoleObject.warn === 'function' ? consoleObject.warn.bind(consoleObject) : null,
    error:
      typeof consoleObject.error === 'function' ? consoleObject.error.bind(consoleObject) : null,
  };

  for (const level of levels) {
    const targetMethod: ConsoleOutputMethodName =
      level === 'trace' ? 'error' : level === 'dir' || level === 'table' ? 'log' : level;
    const originalMethod = originalMethods[targetMethod];

    if (originalMethod === null) {
      continue;
    }

    consoleObject[level] = (...args: unknown[]) => {
      const normalizedArgs = level === 'trace' ? [...args, { stack: new Error().stack }] : args;

      originalMethod(formatSingleLineLogMessage(level, normalizedArgs));
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
