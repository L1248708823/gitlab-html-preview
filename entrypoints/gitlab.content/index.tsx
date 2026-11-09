import { createRoot, type Root } from 'react-dom/client';
import { ArrowUpRight, Eye } from 'lucide-react';
import { useState } from 'react';
import { currentPreviewSource, openPreview } from '../../lib/gitlab';
import './style.css';

function PreviewButton() {
  const [error, setError] = useState(false);

  async function handleOpen() {
    try {
      setError(false);
      const source = currentPreviewSource();
      if (!source) throw new Error('无法识别当前页面。');
      await openPreview(source);
    } catch {
      setError(true);
    }
  }

  return (
    <div className="preview-control">
      {error && <span className="preview-control__error" role="status">打开失败，请重试</span>}
      <button className="preview-control__button" type="button" onClick={handleOpen}>
        <Eye size={17} strokeWidth={1.7} aria-hidden="true" />
        <span>预览页面</span>
        <ArrowUpRight className="preview-control__arrow" size={15} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </div>
  );
}

export default defineContentScript({
  matches: ['https://gitlab.goktech.cn/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    let root: Root | undefined;
    const ui = await createShadowRootUi(ctx, {
      name: 'gitlab-html-preview',
      position: 'overlay',
      anchor: 'body',
      zIndex: 1000,
      onMount(container) {
        root = createRoot(container);
        return root;
      },
      onRemove(mounted) {
        mounted?.unmount();
      },
    });
    ui.mount();

    let previous = '';
    const update = () => {
      const source = currentPreviewSource();
      const next = source?.rawUrl ?? '';
      if (next !== previous) {
        previous = next;
        root?.render(source ? <PreviewButton key={next} /> : null);
      }
    };

    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.addEventListener(window, 'popstate', update);
    ctx.addEventListener(window, 'wxt:locationchange', update);
    ctx.onInvalidated(() => observer.disconnect());
  },
});
