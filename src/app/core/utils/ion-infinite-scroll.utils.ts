export async function completeIonInfiniteScroll(event: Event): Promise<void> {
  const target = event.target as HTMLIonInfiniteScrollElement | null;

  if (!target || typeof target.complete !== 'function') {
    return;
  }

  await target.complete();
}
