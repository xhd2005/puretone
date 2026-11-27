import { ref, watch, type Ref } from 'vue';

const MAX_CACHE_ENTRIES = 120;
const decodedUrlCache = new Set<string>();

export function rememberDecodedUrl(url: string): void {
  const clean = url.trim();
  if (!clean) return;
  if (decodedUrlCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = decodedUrlCache.values().next().value;
    if (oldest) decodedUrlCache.delete(oldest);
  }
  decodedUrlCache.add(clean);
}

export function isCoverUrlDecoded(url: string): boolean {
  return Boolean(url && decodedUrlCache.has(url.trim()));
}

export function clearDecodedCoverCache(): void {
  decodedUrlCache.clear();
}

export function preloadAndDecodeImage(url: string, timeoutMs = 2500): Promise<boolean> {
  const clean = url.trim();
  if (!clean) return Promise.resolve(false);
  if (decodedUrlCache.has(clean)) return Promise.resolve(true);
  if (typeof Image === 'undefined') {
    rememberDecodedUrl(clean);
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) rememberDecodedUrl(clean);
      resolve(ok);
    };

    const timer = setTimeout(() => finish(true), timeoutMs);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(
          () => finish(true),
          () => finish(true),
        );
      } else {
        finish(true);
      }
    };
    img.onerror = () => finish(false);
    img.src = clean;
  });
}

/**
 * Double-buffered cover URL composable: holds the currently visible decoded artwork rock-solid
 * while pre-decoding the next track's bitmap in RAM, eliminating dark empty-box flashes when
 * skipping tracks!
 */
export function useDecodedCover(sourceUrl: () => string): { displayedCoverUrl: Ref<string> } {
  const initial = sourceUrl().trim();
  const displayedCoverUrl = ref(initial);
  if (initial) rememberDecodedUrl(initial);

  let reqSeq = 0;

  watch(
    sourceUrl,
    (nextRaw) => {
      const next = (nextRaw || '').trim();
      const seq = ++reqSeq;

      if (!next) {
        displayedCoverUrl.value = '';
        return;
      }

      if (next === displayedCoverUrl.value) return;

      if (decodedUrlCache.has(next)) {
        displayedCoverUrl.value = next;
        return;
      }

      void preloadAndDecodeImage(next).then((ok) => {
        if (seq !== reqSeq) return;
        displayedCoverUrl.value = ok ? next : '';
      });
    },
    { flush: 'sync' },
  );

  return { displayedCoverUrl };
}
