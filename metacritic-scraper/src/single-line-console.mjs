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
  return value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED_SUFFIX}`;
}

function sanitizeString(value) {
  return truncateString(sanitizeLineBreaks(value));
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function normalizeUnknown(value, seen, depth = 0) {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value ?? null;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol' || typeof value === 'function') {
    return sanitizeString(String(value));
  }

  if (value instanceof Error) {
    return normalizeUnknown(
      {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: value.cause,
      },
      seen,
      depth
    );
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

  if (Array.isArray(value)) {
    const normalizedItems = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => normalizeUnknown(item, seen, depth + 1));

    if (value.length > MAX_ARRAY_ITEMS) {
      normalizedItems.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    }

    return normalizedItems;
  }

  const normalized = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);

  for (const [key, entryValue] of entries) {
    normalized[key] = normalizeUnknown(entryValue, seen, depth + 1);
  }

  const omittedKeyCount = Object.keys(value).length - entries.length;
  if (omittedKeyCount > 0) {
    normalized.__truncatedKeys = omittedKeyCount;
  }

  return normalized;
}

function buildEnvelope(level, args) {
  const payload = {
    ts: new Date().toISOString(),
    level,
  };
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
      if (!(key in payload)) {
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

  for (const level of levels) {
    const original = consoleObject[level];

    if (typeof original !== 'function') {
      continue;
    }

    consoleObject[level] = (...args) =>
      original.call(consoleObject, formatSingleLineLogMessage(level, args));
  }

  Object.defineProperty(consoleObject, SINGLE_LINE_CONSOLE_INSTALLED, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return consoleObject;
}
