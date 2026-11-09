import { AlertCircle, Check, Copy, FileCode2, LoaderCircle, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseRepositoryLink, resolveRepositoryLink } from '../../lib/links';
import { loadRawFile, preparePreview } from '../../lib/prepare-preview';
import { blobFileUrl, rawFileUrl, resolveRepository, type Repository } from '../../lib/repository';
import { MarkdownView } from './markdown';
import { Workspace } from './workspace';

type Status =
  | { type: 'loading' }
  | { type: 'html'; rawUrl: string; warnings: string[] }
  | { type: 'markdown'; rawUrl: string; content: string }
  | { type: 'error'; rawUrl: string; message: string };

interface HtmlPage {
  rawUrl: string;
  fileName: string;
  html: string;
  warnings: string[];
  hash: string;
}

interface DocumentLocation {
  rawUrl: string;
  fileName: string;
  path: string;
  hash: string;
  sequence: number;
  restorePosition: boolean;
}

function locationFromUrl(): DocumentLocation {
  const params = new URLSearchParams(window.location.search);
  return {
    rawUrl: params.get('file') ?? '',
    fileName: params.get('name') ?? '预览',
    path: params.get('path') ?? '',
    hash: params.get('anchor') ?? '',
    sequence: 0,
    restorePosition: false,
  };
}

function navigateUrl(location: DocumentLocation, repository: Repository | null): URL {
  const url = new URL(window.location.href);
  url.searchParams.set('file', location.rawUrl);
  url.searchParams.set('name', location.fileName);
  url.searchParams.set('path', location.path);
  if (repository) url.searchParams.set('ref', repository.ref);
  if (location.hash) url.searchParams.set('anchor', location.hash);
  else url.searchParams.delete('anchor');
  return url;
}

export function Preview() {
  const [location, setLocation] = useState<DocumentLocation>(locationFromUrl);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [repositoryError, setRepositoryError] = useState('');
  const [status, setStatus] = useState<Status>({ type: 'loading' });
  const [warningVisible, setWarningVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [htmlPages, setHtmlPages] = useState<HtmlPage[]>([]);
  const htmlPagesRef = useRef(new Map<string, HtmlPage>());
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const markdownPositions = useRef(new Map<string, number>());
  const markdownContent = useRef(new Map<string, string>());

  useEffect(() => {
    const initial = locationFromUrl();
    const params = new URLSearchParams(window.location.search);
    let cancelled = false;
    resolveRepository(initial.rawUrl, params.get('ref') ?? '', initial.path).then(
      (result) => {
        if (cancelled) return;
        setRepository(result);
        setRepositoryError('');
        const updated = { ...initial, path: result.filePath };
        window.history.replaceState(null, '', navigateUrl(updated, result));
        setLocation(updated);
      },
      (error: unknown) => {
        if (!cancelled) setRepositoryError(error instanceof Error ? error.message : '无法读取仓库目录。');
      },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.title = `${location.fileName} · 预览`;
    setStatus((current) => current.type !== 'loading' && current.rawUrl === location.rawUrl ? current : { type: 'loading' });
    setWarningVisible(true);
    setCopied(false);
    let cancelled = false;
    const rawUrl = location.rawUrl;
    const cachedPage = htmlPagesRef.current.get(rawUrl);
    if (cachedPage) {
      setStatus({ type: 'html', rawUrl, warnings: cachedPage.warnings });
      return () => { cancelled = true; };
    }
    const cachedMarkdown = markdownContent.current.get(rawUrl);
    const loading: Promise<Status> = /\.md$/i.test(location.fileName)
      ? (cachedMarkdown !== undefined ? Promise.resolve(cachedMarkdown) : loadRawFile(rawUrl)).then((content) => {
        if (!cancelled) markdownContent.current.set(rawUrl, content);
        return { type: 'markdown', rawUrl, content };
      })
      : preparePreview(rawUrl).then((result) => {
        if (!cancelled) {
          const page = { rawUrl, fileName: location.fileName, hash: location.hash, ...result };
          htmlPagesRef.current.set(rawUrl, page);
          setHtmlPages((current) => [...current, page]);
        }
        return { type: 'html', rawUrl, warnings: result.warnings };
      });
    loading.then(
      (result) => { if (!cancelled) setStatus(result); },
      (error: unknown) => {
        if (!cancelled) setStatus({ type: 'error', rawUrl, message: error instanceof Error ? error.message : '加载失败，请重试。' });
      },
    );
    return () => { cancelled = true; };
  }, [location.rawUrl, location.fileName]);

  useEffect(() => {
    const restore = () => {
      setLinkError('');
      setLocation({ ...locationFromUrl(), sequence: Date.now(), restorePosition: true });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const selectFile = useCallback((url: string, path: string, hash = '') => {
    const next = {
      rawUrl: url,
      fileName: path.split('/').pop() || '预览',
      path,
      hash,
      sequence: Date.now(),
      restorePosition: true,
    };
    window.history.pushState(null, '', navigateUrl(next, repository));
    setLinkError('');
    setLocation(next);
  }, [repository]);

  const navigate = useCallback(async (href: string) => {
    if (href.startsWith('#')) {
      const next = { ...location, hash: href, sequence: Date.now(), restorePosition: false };
      window.history.pushState({ anchor: href }, '', navigateUrl(next, repository));
      setLocation(next);
      return;
    }
    const link = repository && parseRepositoryLink(href, repository, location.path);
    if (!link) {
      if (!repository && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(href)) {
        setLinkError('无法读取仓库信息，请重新打开预览。');
        return;
      }
      try { window.open(new URL(href, location.rawUrl).href, '_blank', 'noopener,noreferrer'); }
      catch { setLinkError('无法识别链接。'); }
      return;
    }
    if (!repository) return;
    if (!link.outsideRepository && link.path === location.path) {
      const next = { ...location, hash: link.hash, sequence: Date.now(), restorePosition: false };
      window.history.pushState({ anchor: link.hash }, '', navigateUrl(next, repository));
      setLocation(next);
      return;
    }
    if (!/\.(?:html?|md)$/i.test(link.path)) {
      const target = new URL(blobFileUrl(repository, link.path));
      target.search = link.search;
      target.hash = link.hash;
      window.open(target.href, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const path = await resolveRepositoryLink(link, repository);
      if (!path) {
        setLinkError(`找不到链接目标：${href}`);
        return;
      }
      const url = new URL(rawFileUrl(repository, path));
      url.search = link.search;
      selectFile(url.href, path, link.hash);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : '无法打开链接。');
    }
  }, [location, repository, selectFile]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frames.current.get(location.rawUrl)?.contentWindow || event.data?.type !== 'navigate-preview' || typeof event.data.href !== 'string') return;
      void navigate(event.data.href);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [location.rawUrl, navigate]);

  useEffect(() => {
    if (status.type === 'html' && status.rawUrl === location.rawUrl && location.hash) {
      frames.current.get(location.rawUrl)?.contentWindow?.postMessage({ type: 'preview-anchor', hash: location.hash }, '*');
    }
  }, [location.hash, location.rawUrl, location.sequence, status]);

  const visibleStatus: Status = status.type === 'loading' || status.rawUrl === location.rawUrl ? status : { type: 'loading' };

  return (
    <main className="preview-layout">
      <div className="preview-content">
        {htmlPages.map((page) => (
          <div key={page.rawUrl} className={`preview-frame-layer${visibleStatus.type === 'html' && location.rawUrl === page.rawUrl ? ' preview-frame-layer--active' : ''}`} aria-hidden={visibleStatus.type !== 'html' || location.rawUrl !== page.rawUrl} inert={visibleStatus.type !== 'html' || location.rawUrl !== page.rawUrl}>
            <iframe
              ref={(element) => { if (element) frames.current.set(page.rawUrl, element); else frames.current.delete(page.rawUrl); }}
              className="preview-frame"
              title={page.fileName}
              src={browser.runtime.getURL('/sandbox.html')}
              onLoad={() => frames.current.get(page.rawUrl)?.contentWindow?.postMessage({ type: 'render', html: page.html, hash: page.hash }, '*')}
            />
          </div>
        ))}
        {visibleStatus.type === 'html' ? (
          <>
            {warningVisible && visibleStatus.warnings.length > 0 && (
              <div className="resource-notice" role="status">
                <AlertCircle size={17} aria-hidden="true" />
                <span>部分资源加载失败：{visibleStatus.warnings.join('、')}</span>
                <button type="button" aria-label={copied ? '已复制错误信息' : '复制错误信息'} title={copied ? '已复制' : '复制错误信息'} onClick={() => { void navigator.clipboard.writeText(`部分资源加载失败：${visibleStatus.warnings.join('、')}`).then(() => setCopied(true)); }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
                <button type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setWarningVisible(false)}><X size={16} /></button>
              </div>
            )}
          </>
        ) : visibleStatus.type === 'markdown' ? (
          <MarkdownView content={visibleStatus.content} currentPath={location.path} repository={repository} hash={location.hash} navigationKey={location.sequence} restoredPosition={location.restorePosition ? markdownPositions.current.get(location.rawUrl) : undefined} onPositionChange={(position) => markdownPositions.current.set(location.rawUrl, position)} onNavigate={(href) => { void navigate(href); }} />
        ) : visibleStatus.type === 'loading' ? (
          <div className="loading-page" role="status">
            <div className="loading-indicator"><LoaderCircle size={21} strokeWidth={1.7} aria-hidden="true" /><span>正在加载页面</span></div>
          </div>
        ) : (
          <div className="status-page">
            <section className="status-card" aria-live="polite">
              <div className="status-icon"><FileCode2 size={24} strokeWidth={1.6} aria-hidden="true" /></div>
              <h1>无法加载页面</h1><p>{visibleStatus.message}</p>
              <button type="button" className="retry-button" onClick={() => window.location.reload()}><RotateCw size={16} strokeWidth={1.7} aria-hidden="true" />重新加载</button>
            </section>
          </div>
        )}
        {linkError && (
          <div className="link-notice" role="status">
            <AlertCircle size={17} aria-hidden="true" />
            <span>{linkError}</span>
            <button type="button" aria-label="复制错误信息" title="复制错误信息" onClick={() => { void navigator.clipboard.writeText(linkError); }}><Copy size={16} /></button>
            <button type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setLinkError('')}><X size={16} /></button>
          </div>
        )}
      </div>
      <Workspace repository={repository} error={repositoryError} currentPath={location.path} onSelect={selectFile} />
    </main>
  );
}
