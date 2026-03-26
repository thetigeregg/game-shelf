const SINGLE_LINE_CONSOLE_INSTALLED = Symbol.for('game-shelf.singleLineConsole.installed');
const EVENT_PREFIX_PATTERN = /^\[([^[\]]+)\]\s+(.+)$/;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 5;
const TRUNCATED_SUFFIX = '...[truncated]';

function sanitizeLineBreaks(value) {
  return String(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function truncateString(value) {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  const availableForContent = Math.max(0, MAX_STRING_LENGTH - TRUNCATED_SUFFIX.length);

  return `${value.slice(0, availableForContent)}${TRUNCATED_SUFFIX}`;
}

function sanitizeString(value) {
  return truncateString(sanitizeLineBreaks(value));
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function createSafeRecord() {
  return Object.create(null);
}

function normalizeUnknown(value, seen, depth = 0) {
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

  if (value instanceof Error) {
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

  if (typeof value !== 'object' || value === null) {
    return sanitizeString(String(value));
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (depth >= MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
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
        normalizedItems.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
      }

      return normalizedItems;
    }

    if (!isPlainObject(value)) {
      return sanitizeString(String(value));
    }

    const normalized = createSafeRecord();
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);

    for (const [key, entryValue] of entries) {
      normalized[key] = normalizeUnknown(entryValue, seen, depth + 1);
    }

    const omittedKeyCount = Object.keys(value).length - entries.length;
    if (omittedKeyCount > 0) {
      normalized.__truncatedKeys = omittedKeyCount;
    }

    return normalized;
  } finally {
    seen.delete(value);
  }
}

function buildEnvelope(level, args) {
  const payload = createSafeRecord();
  payload.ts = new Date().toISOString();
  payload.level = level;
  const normalizedArgs = args.map((value) => normalizeUnknown(value, new WeakSet()));
  const first = normalizedArgs[0];
  let argsStartIndex = 0;

  if (typeof first === 'string') {
    const eventMatch = first.match(EVENT_PREFIX_PATTERN);

    if (eventMatch) {
      payload.service = eventMatch[1];
      payload.event = eventMatch[2];
      argsStartIndex = 1;
    } else {
      payload.message = first;
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
    payload.args = otherArgs;
  }

  if (!('service' in payload)) {
    payload.service = 'app';
  }

  if (!('event' in payload) && !('message' in payload)) {
    payload.event = 'log';
  }

  return payload;
}

export function formatSingleLineLogMessage(level, args) {
  if (!Array.isArray(args) || args.length === 0) {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: 'app',
      event: 'log',
    });
  }

  return JSON.stringify(buildEnvelope(level, args));
}

export function installSingleLineConsole(consoleObject = console) {
  if (consoleObject[SINGLE_LINE_CONSOLE_INSTALLED]) {
    return consoleObject;
  }

  const levels = ['debug', 'info', 'log', 'warn', 'error', 'trace', 'dir', 'table'];
  const originalMethods = {
    debug:
      typeof consoleObject.debug === 'function' ? consoleObject.debug.bind(consoleObject) : null,
    info: typeof consoleObject.info === 'function' ? consoleObject.info.bind(consoleObject) : null,
    log: typeof consoleObject.log === 'function' ? consoleObject.log.bind(consoleObject) : null,
    warn: typeof consoleObject.warn === 'function' ? consoleObject.warn.bind(consoleObject) : null,
    error:
      typeof consoleObject.error === 'function' ? consoleObject.error.bind(consoleObject) : null,
  };

  for (const level of levels) {
    const targetMethod =
      level === 'trace' ? 'error' : level === 'dir' || level === 'table' ? 'log' : level;
    const original = originalMethods[targetMethod];

    if (original === null) {
      continue;
    }

    consoleObject[level] = (...args) => {
      const normalizedArgs = level === 'trace' ? [...args, { stack: new Error().stack }] : args;

      original(formatSingleLineLogMessage(level, normalizedArgs));
    };
  }

  Object.defineProperty(consoleObject, SINGLE_LINE_CONSOLE_INSTALLED, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return consoleObject;
}
