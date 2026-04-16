export const MAX_NOTIFICATION_TITLE = 40;
export const MAX_NOTIFICATION_BODY = 90;

export function clampTitleWithEllipsis(title: string, max = MAX_NOTIFICATION_TITLE): string {
  const normalized = title.trim();
  if (normalized.length <= max) {
    return normalized;
  }

  if (max <= 3) {
    return '.'.repeat(Math.max(0, max));
  }

  return `${normalized.slice(0, max - 3).trimEnd()}...`;
}

export function clampTitleWithSuffix(args: {
  baseTitle: string;
  suffix: string;
  max?: number;
}): string {
  const max = args.max ?? MAX_NOTIFICATION_TITLE;
  const normalizedSuffix = args.suffix.trim();
  if (normalizedSuffix.length === 0) {
    return clampTitleWithEllipsis(args.baseTitle, max);
  }

  const joined = `${args.baseTitle.trim()} ${normalizedSuffix}`;
  if (joined.length <= max) {
    return joined;
  }

  const minimumBaseBudget = 4;
  const availableBase = max - normalizedSuffix.length - 1;
  if (availableBase < minimumBaseBudget) {
    return clampTitleWithEllipsis(joined, max);
  }

  const clampedBase = clampTitleWithEllipsis(args.baseTitle, availableBase);
  return `${clampedBase} ${normalizedSuffix}`;
}
