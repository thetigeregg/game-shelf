/**
 * Runs the search for each title variant in turn and merges their candidates. A variant that fails
 * doesn't discard what the others found: its error is returned in `failures` for logging. Only when
 * every variant fails is the first error thrown, so a request that found nothing reports why.
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

  if (failures.length > 0 && failures.length === variants.length) {
    throw failures[0].error;
  }

  return { candidates, failures };
}
