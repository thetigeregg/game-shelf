/**
 * Runs the search for each title variant in turn and merges their candidates. A variant that fails
 * doesn't discard what the others found: its error is returned in `failures` for logging. When
 * nothing was found and any variant failed, the first error is thrown instead: the failed variant
 * might have been the one that matched, so the result can't be reported as "no match".
 */
export async function searchTitleVariants(variants, searchVariant) {
  const candidates = [];
  const failures = [];

  for (const variant of variants) {
    try {
      candidates.push(...(await searchVariant(variant)));
    } catch (error) {
      failures.push({ variant, error });
    }
  }

  if (failures.length > 0 && candidates.length === 0) {
    throw failures[0].error;
  }

  return { candidates, failures };
}
