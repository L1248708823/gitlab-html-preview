export const GITLAB_ORIGIN = 'https://gitlab.goktech.cn';

export interface PreviewSource {
  rawUrl: string;
  fileName: string;
  ref?: string;
  filePath?: string;
}

export function currentPreviewSource(): PreviewSource | null {
  const page = new URL(window.location.href);
  if (page.origin !== GITLAB_ORIGIN || !page.pathname.includes('/-/blob/')) return null;

  const encodedName = page.pathname.split('/').pop() ?? '';
  let fileName: string;
  try {
    fileName = decodeURIComponent(encodedName);
  } catch {
    fileName = encodedName;
  }
  if (!/\.(?:html?|md)$/i.test(fileName)) return null;

  const rawUrl = new URL(page.href);
  rawUrl.pathname = page.pathname.replace('/-/blob/', '/-/raw/');
  rawUrl.hash = '';
  const ref = document.querySelector<HTMLElement>('.js-project-refs-dropdown[data-ref], #js-ambiguous-ref-modal[data-ref]')?.dataset.ref;
  let filePath: string | undefined;
  if (ref) {
    try {
      const remainder = decodeURIComponent(page.pathname.split('/-/blob/')[1] ?? '');
      if (remainder.startsWith(`${ref}/`)) filePath = remainder.slice(ref.length + 1);
    } catch {
      // The preview can still open; repository details can be resolved separately.
    }
  }
  return { rawUrl: rawUrl.href, fileName, ref, filePath };
}

export async function openPreview(source: PreviewSource): Promise<void> {
  const preview = new URL(browser.runtime.getURL('/preview.html'));
  preview.searchParams.set('file', source.rawUrl);
  preview.searchParams.set('name', source.fileName);
  if (source.ref) preview.searchParams.set('ref', source.ref);
  if (source.filePath) preview.searchParams.set('path', source.filePath);
  await browser.runtime.sendMessage({ type: 'open-preview', url: preview.href });
}
