export function canOpenMetadataFilter(
  showLibrarySections: boolean,
  values: string[] | null | undefined
): boolean {
  return (
    showLibrarySections && Array.isArray(values) && values.some((value) => value.trim().length > 0)
  );
}
