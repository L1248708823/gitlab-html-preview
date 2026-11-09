window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.type !== 'render' || typeof event.data.html !== 'string') return;
  document.open();
  document.write(event.data.html);
  document.close();
  if (typeof event.data.hash === 'string' && event.data.hash.startsWith('#')) {
    let id = event.data.hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Keep the literal fragment. */ }
    requestAnimationFrame(() => {
      const target = document.getElementById(id) || document.getElementsByName(id)[0];
      if (target) target.scrollIntoView();
    });
  }
}, { once: true });
