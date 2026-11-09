document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

  const href = link.getAttribute('href')?.trim();
  if (!href) return;
  if (href.startsWith('#')) {
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Keep the literal fragment. */ }
    const target = document.getElementById(id) || document.getElementsByName(id)[0];
    event.preventDefault();
    if (target) target.scrollIntoView();
    return;
  }

  if (/^(?:https?:)?\/\//i.test(href)) {
    const project = document.baseURI.split('/-/raw/')[0];
    if (!href.startsWith(`${project}/-/raw/`) && !href.startsWith(`${project}/-/blob/`)) return;
  }
  const url = new URL(href, document.baseURI);
  if (url.origin !== 'https://gitlab.goktech.cn' || !/\.(?:html?|md)$/i.test(url.pathname)) return;
  event.preventDefault();
  window.parent.postMessage({ type: 'navigate-preview', href }, '*');
});

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.type !== 'preview-anchor' || typeof event.data.hash !== 'string') return;
  let id = event.data.hash.replace(/^#/, '');
  try { id = decodeURIComponent(id); } catch { /* Keep the literal fragment. */ }
  const target = document.getElementById(id) || document.getElementsByName(id)[0];
  if (target) target.scrollIntoView();
});
