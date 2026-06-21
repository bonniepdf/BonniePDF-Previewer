import { namespaceSvgIds } from './dom';

/** A running windowed mounter; `disconnect()` stops further mount/unmount. */
export interface LazyMounter {
  disconnect(): void;
}

/**
 * Windowed lazy mount/unmount of SVG items inside a scroll container: each item's
 * markup is injected only while it is near the viewport and emptied once it
 * scrolls away, so only a handful of (potentially huge) page/thumbnail SVGs are
 * ever live in the DOM. The namespaced markup for each index is memoised, so
 * re-entering the viewport never re-runs the id-rewriting regexes over the same
 * string. Falls back to mounting everything when there's no `IntersectionObserver`.
 *
 * Placeholders keep their own box (sized by the caller), so scroll position stays
 * stable as content comes and goes.
 */
export function observeLazyMount(
  items: HTMLElement[],
  svgFor: (index: number) => string,
  prefixFor: (index: number) => string,
  scrollRoot: HTMLElement | null,
  rootMargin: string,
): LazyMounter {
  const cache = new Map<number, string>();

  const mount = (host: HTMLElement, index: number): void => {
    if (host.dataset.mounted === 'true') return;
    let html = cache.get(index);
    if (html === undefined) {
      html = namespaceSvgIds(svgFor(index), prefixFor(index));
      cache.set(index, html);
    }
    host.innerHTML = html;
    host.dataset.mounted = 'true';
  };

  const unmount = (host: HTMLElement): void => {
    if (host.dataset.mounted !== 'true') return;
    host.replaceChildren();
    host.dataset.mounted = 'false';
  };

  items.forEach((el, index) => {
    el.dataset.lazyIndex = String(index);
  });

  // Mount the first item up front so there's no blank flash before the observer's
  // first (async) callback.
  if (items[0]) mount(items[0], 0);

  if (scrollRoot && typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const host = entry.target as HTMLElement;
          const index = Number(host.dataset.lazyIndex);
          if (entry.isIntersecting) mount(host, index);
          else unmount(host);
        }
      },
      { root: scrollRoot, rootMargin },
    );
    items.forEach(el => io.observe(el));
    return { disconnect: () => io.disconnect() };
  }

  items.forEach((el, index) => mount(el, index));
  return { disconnect() {} };
}
