import { GITLAB_ORIGIN } from './gitlab';

interface PreparedPreview {
  html: string;
  warnings: string[];
}

export async function fetchFile(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: 'include' });
  if (response.redirected && new URL(response.url).pathname.includes('/users/sign_in')) {
    throw new Error('GitLab 登录已失效，请先重新登录。');
  }
  if (!response.ok) {
    throw new Error(response.status === 404 ? '文件不存在或无权访问。' : `读取文件失败（${response.status}）。`);
  }
  return response;
}

export async function loadRawFile(rawUrl: string): Promise<string> {
  let source: URL;
  try {
    source = new URL(rawUrl);
  } catch {
    throw new Error('无法识别文件地址，请从 GitLab 重新打开预览。');
  }
  if (source.origin !== GITLAB_ORIGIN || !source.pathname.includes('/-/raw/')) {
    throw new Error('无法识别文件地址，请从 GitLab 重新打开预览。');
  }
  return (await fetchFile(source.href)).text();
}

function isRelativeResource(value: string): boolean {
  const path = value.trim();
  return path.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(path);
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取资源。'));
    reader.readAsDataURL(blob);
  });
}

function resourceType(url: URL, suppliedType: string): string {
  if (suppliedType && suppliedType !== 'text/plain' && suppliedType !== 'application/octet-stream') return suppliedType;
  const extension = url.pathname.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon', jpeg: 'image/jpeg',
    jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm',
  };
  return types[extension ?? ''] ?? (suppliedType || 'application/octet-stream');
}

export async function preparePreview(rawUrl: string): Promise<PreparedPreview> {
  let source: URL;
  try {
    source = new URL(rawUrl);
  } catch {
    throw new Error('无法识别文件地址，请从 GitLab 重新打开预览。');
  }
  if (source.origin !== GITLAB_ORIGIN || !source.pathname.includes('/-/raw/')) {
    throw new Error('无法识别文件地址，请从 GitLab 重新打开预览。');
  }

  const html = await loadRawFile(source.href);
  const document = new DOMParser().parseFromString(html, 'text/html');
  const warnings = new Set<string>();
  const cache = new Map<string, Promise<string>>();

  async function localResource(value: string, base: string): Promise<string> {
    if (!isRelativeResource(value)) return value;
    const url = new URL(value, base);
    if (url.origin !== GITLAB_ORIGIN) return value;
    const key = url.href;
    let loading = cache.get(key);
    if (!loading) {
      loading = (async () => {
        const asset = await fetchFile(key);
        const blob = await asset.blob();
        return asDataUrl(new Blob([blob], { type: resourceType(url, (blob.type.split(';')[0] ?? '').trim()) }));
      })();
      cache.set(key, loading);
    }
    try {
      return await loading;
    } catch {
      warnings.add(value);
      return '';
    }
  }

  async function rewriteCss(css: string, base: string, usedFontAwesome: boolean): Promise<string> {
    if (!usedFontAwesome) {
      css = css.replace(/@font-face\s*\{[^{}]*font-family\s*:\s*(['"]?)FontAwesome\1[^{}]*\}/gi, '');
    }
    const pattern = /url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/gi;
    const matches = Array.from(css.matchAll(pattern));
    const replacements = await Promise.all(matches.map(async (match) => {
      const value = (match[2] ?? match[3] ?? '').trim();
      const replacement = await localResource(value, base);
      return replacement === value ? match[0] : `url("${replacement}")`;
    }));
    let output = css;
    for (let index = matches.length - 1; index >= 0; index--) {
      const match = matches[index]!;
      output = output.slice(0, match.index) + replacements[index]! + output.slice(match.index! + match[0].length);
    }
    return output;
  }

  const jobs: Promise<void>[] = [];
  const usedFontAwesome = /\bfa-[a-z0-9-]+/i.test(Array.from(document.querySelectorAll('[class], script')).map((element) => element.getAttribute('class') ?? element.textContent ?? '').join(' '));
  document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((link) => {
    const href = link.getAttribute('href') ?? '';
    if (!isRelativeResource(href)) return;
    jobs.push((async () => {
      try {
        const cssUrl = new URL(href, source.href).href;
        const css = await (await fetchFile(cssUrl)).text();
        const style = document.createElement('style');
        if (link.getAttribute('media')) style.media = link.getAttribute('media')!;
        style.textContent = await rewriteCss(css, cssUrl, usedFontAwesome);
        link.replaceWith(style);
      } catch {
        warnings.add(href);
      }
    })());
  });
  document.querySelectorAll('script[src]').forEach((script) => {
    const src = script.getAttribute('src') ?? '';
    if (!isRelativeResource(src)) return;
    jobs.push((async () => {
      try {
        const asset = await fetchFile(new URL(src, source.href).href);
        const text = await asset.text();
        script.setAttribute('src', await asDataUrl(new Blob([text], { type: 'text/javascript' })));
      } catch {
        warnings.add(src);
      }
    })());
  });
  document.querySelectorAll('[src], [poster], link[rel~="icon"][href]').forEach((element) => {
    if (element.tagName === 'SCRIPT') return;
    for (const attribute of ['src', 'poster', ...(element.tagName === 'LINK' ? ['href'] : [])]) {
      const value = element.getAttribute(attribute);
      if (!value || !isRelativeResource(value)) continue;
      jobs.push(localResource(value, source.href).then((resolved) => { element.setAttribute(attribute, resolved); }));
    }
  });
  document.querySelectorAll('[srcset]').forEach((element) => {
    const value = element.getAttribute('srcset') ?? '';
    jobs.push((async () => {
      const entries = await Promise.all(value.split(',').map(async (entry) => {
        const [url = '', ...descriptors] = entry.trim().split(/\s+/);
        return [await localResource(url, source.href), ...descriptors].join(' ');
      }));
      element.setAttribute('srcset', entries.join(', '));
    })());
  });
  document.querySelectorAll('style').forEach((style) => {
    jobs.push(rewriteCss(style.textContent ?? '', source.href, usedFontAwesome).then((css) => { style.textContent = css; }));
  });
  document.querySelectorAll('[style]').forEach((element) => {
    jobs.push(rewriteCss(element.getAttribute('style') ?? '', source.href, usedFontAwesome).then((css) => { element.setAttribute('style', css); }));
  });
  await Promise.all(jobs);

  const base = document.createElement('base');
  base.href = source.href;
  document.head.prepend(base);
  const navigation = document.createElement('script');
  navigation.src = browser.runtime.getURL('/navigation.js');
  document.head.insertBefore(navigation, base.nextSibling);
  const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '<!DOCTYPE html>';
  return { html: `${doctype}\n${document.documentElement.outerHTML}`, warnings: [...warnings] };
}
