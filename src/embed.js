/** @returns {string | null} */
export function approvedParentOrigin(pageHref, referrer, directChild) {
  if (!directChild) return null;
  try {
    const page = new URL(pageHref);
    const parent = new URL(referrer);
    const sameOriginGuide = parent.origin === page.origin &&
      ['/little-ai/', '/little-ai/index.html'].includes(parent.pathname);
    const localGuide = page.origin === 'http://127.0.0.1:4174' &&
      parent.origin === 'http://127.0.0.1:4173';
    return sameOriginGuide || localGuide ? parent.origin : null;
  } catch {
    return null;
  }
}
