export function canOpenMetadataFilter(
  showLibrarySections: boolean,
  allowMetadataFilterLinks: boolean,
  values: string[] | null | undefined
): boolean {
  return (
    showLibrarySections &&
    allowMetadataFilterLinks &&
    Array.isArray(values) &&
    values.some((value) => value.trim().length > 0)
  );
}
