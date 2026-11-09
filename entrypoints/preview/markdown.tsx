import { ChevronDown, ChevronUp, Columns2, List, Maximize2, Search, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { parseRepositoryLink, resolveRepositoryLink } from '../../lib/links';
import { rawFileUrl, type Repository } from '../../lib/repository';

interface Heading {
  id: string;
  text: string;
  level: number;
}

interface MarkdownViewProps {
  content: string;
  currentPath: string;
  repository: Repository | null;
  hash: string;
  navigationKey: number;
  restoredPosition?: number;
  onPositionChange: (position: number) => void;
  onNavigate: (href: string) => void;
}

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  clobberPrefix: '',
};
const remarkPlugins = [remarkGfm];

function readSetting(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === 'true';
}

function RepositoryImage({ source, repository, currentPath, ...props }: React.ComponentProps<'img'> & { source?: string; repository: Repository | null; currentPath: string }) {
  const [corrected, setCorrected] = useState('');
  const [failed, setFailed] = useState(false);
  const link = useMemo(() => repository && source ? parseRepositoryLink(source, repository, currentPath) : null, [source, repository, currentPath]);
  const original = link && repository && !link.outsideRepository
    ? `${rawFileUrl(repository, link.path)}${link.search}${link.hash}`
    : link ? undefined : source;

  useEffect(() => { setCorrected(''); setFailed(false); }, [source, currentPath, repository?.ref]);

  async function handleError() {
    if (!link || !repository || corrected || link.absolute) return;
    try {
      const resolved = await resolveRepositoryLink(link, repository);
      if (resolved && resolved !== link.path) setCorrected(`${rawFileUrl(repository, resolved)}${link.search}${link.hash}`);
      else if (link.outsideRepository) setFailed(true);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    if (link?.outsideRepository) void handleError();
  }, [link]);

  if (failed && link?.outsideRepository) return <span className="markdown-image-error">图片加载失败：{source}</span>;
  return <img {...props} src={corrected || original} loading="lazy" onError={() => { void handleError(); }} />;
}

export function MarkdownView({ content, currentPath, repository, hash, navigationKey, restoredPosition, onPositionChange, onNavigate }: MarkdownViewProps) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState('');
  const [showContents, setShowContents] = useState(() => readSetting('markdown-contents', true));
  const [wide, setWide] = useState(() => readSetting('markdown-wide', false));
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<Range[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const node = scroller.current;
    const save = onPositionChange;
    return () => { if (node) save(node.scrollTop); };
  }, [currentPath]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (restoredPosition !== undefined) {
      node.scrollTop = restoredPosition;
      updateActiveHeading();
    } else if (hash) {
      let id = hash.slice(1);
      try { id = decodeURIComponent(id); } catch { /* Keep the literal fragment. */ }
      const target = Array.from(article.current?.querySelectorAll<HTMLElement>('[id], [name]') ?? []).find((element) => element.id === id || element.getAttribute('name') === id);
      if (target) {
        node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top - 28;
        setActive(target.id);
      }
    } else {
      node.scrollTop = 0;
    }
  }, [content, currentPath, hash, navigationKey, restoredPosition]);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && focused.closest('.workspace__search')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setShowSearch(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      }
    };
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, []);

  useEffect(() => {
    const container = article.current;
    const query = searchQuery.trim();
    const ranges: Range[] = [];
    if (showSearch && query && container) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const groups: { parent: Element; text: string; nodes: { node: Text; start: number; end: number }[] }[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.parentElement || node.parentElement.closest('button, input, .sr-only')) continue;
        const text = node.textContent ?? '';
        const parent = node.parentElement.closest('p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote') ?? container;
        let group = groups[groups.length - 1];
        if (!group || group.parent !== parent) {
          group = { parent, text: '', nodes: [] };
          groups.push(group);
        }
        const start = group.text.length;
        group.text += text;
        group.nodes.push({ node: node as Text, start, end: group.text.length });
      }
      const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const group of groups) {
        for (const match of group.text.matchAll(new RegExp(pattern, 'giu'))) {
          const start = match.index;
          const end = start + match[0].length;
          const first = group.nodes.find((item) => item.start <= start && item.end > start);
          const last = group.nodes.find((item) => item.start < end && item.end >= end);
          if (!first || !last) continue;
          const range = document.createRange();
          range.setStart(first.node, start - first.start);
          range.setEnd(last.node, end - last.start);
          ranges.push(range);
        }
      }
    }
    setMatches(ranges);
    setMatchIndex(0);
    if ('highlights' in CSS) {
      if (ranges.length) CSS.highlights.set('document-search', new Highlight(...ranges));
      else CSS.highlights.delete('document-search');
    }
    return () => {
      if ('highlights' in CSS) {
        CSS.highlights.delete('document-search');
        CSS.highlights.delete('document-search-active');
      }
    };
  }, [content, currentPath, repository, searchQuery, showSearch]);

  useEffect(() => {
    if ('highlights' in CSS) {
      if (matches[matchIndex]) CSS.highlights.set('document-search-active', new Highlight(matches[matchIndex]));
      else CSS.highlights.delete('document-search-active');
    }
    const rect = matches[matchIndex]?.getBoundingClientRect();
    const node = scroller.current;
    if (rect && node) {
      const bounds = node.getBoundingClientRect();
      node.scrollTop += rect.top - bounds.top - node.clientHeight / 3;
      if (rect.left < bounds.left || rect.right > bounds.right) {
        const element = matches[matchIndex]?.startContainer.parentElement;
        const table = element?.closest('.markdown-table');
        if (element && table) {
          const tableRect = table.getBoundingClientRect();
          table.scrollLeft += element.getBoundingClientRect().left - tableRect.left - 24;
        }
      }
    }
    return () => { if ('highlights' in CSS) CSS.highlights.delete('document-search-active'); };
  }, [matches, matchIndex]);

  function moveMatch(direction: number) {
    if (matches.length) setMatchIndex((current) => (current + direction + matches.length) % matches.length);
  }

  function closeSearch() {
    setShowSearch(false);
    setSearchQuery('');
  }

  useEffect(() => {
    localStorage.setItem('markdown-contents', String(showContents));
    localStorage.setItem('markdown-wide', String(wide));
  }, [showContents, wide]);

  useEffect(() => {
    const elements = Array.from(article.current?.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]') ?? []).filter((element) => !element.classList.contains('sr-only'));
    setHeadings(elements.map((element) => ({
      id: element.id,
      text: element.textContent?.trim() ?? '',
      level: Number(element.tagName.slice(1)),
    })));
    setActive(elements[0]?.id ?? '');
  }, [content, currentPath]);

  function updateActiveHeading() {
    const container = scroller.current;
    if (!container) return;
    onPositionChange(container.scrollTop);
    const top = container.getBoundingClientRect().top + 90;
    const elements = Array.from(article.current?.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]') ?? []).filter((element) => !element.classList.contains('sr-only'));
    let current = elements[0]?.id ?? '';
    for (const heading of elements) {
      if (heading.getBoundingClientRect().top > top) break;
      current = heading.id;
    }
    setActive(current);
  }

  function handleClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as Element;
    const link = target.closest('a[href]');
    if (!link || link.hasAttribute('download') || (link.getAttribute('target') && link.getAttribute('target') !== '_self')) return;
    const href = link.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    onNavigate(href);
  }

  const components = useMemo<Components>(() => ({
    table({ children }: { children?: React.ReactNode }) {
      return <div className="markdown-table"><table>{children}</table></div>;
    },
    img({ node: _node, src, ...props }: React.ComponentProps<'img'> & { node?: unknown }) {
    if (!repository && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src ?? '')) return <span className="markdown-image-error">图片加载中</span>;
      return <RepositoryImage {...props} source={src} repository={repository} currentPath={currentPath} />;
    },
  }), [currentPath, repository]);

  return (
    <div className="markdown-view">
        {showContents && (
          <aside className="markdown-toc" aria-label="文档目录">
            <div className="markdown-toc__header">
              <span>目录</span>
              <button type="button" className="reader-icon" title="收起目录" aria-label="收起目录" onClick={() => setShowContents(false)}><X size={17} /></button>
            </div>
            <nav className="markdown-toc__list">
              {headings.map((heading) => (
                <button key={heading.id} type="button" title={heading.text} className={`markdown-toc__item${active === heading.id ? ' markdown-toc__item--active' : ''}`} style={{ paddingLeft: 12 + Math.max(0, heading.level - 1) * 12 }} onClick={() => onNavigate(`#${encodeURIComponent(heading.id)}`)}>
                  {heading.text}
                </button>
              ))}
            </nav>
          </aside>
        )}
        <div className="markdown-main">
        <div className="markdown-toolbar">
          {!showContents && <button type="button" className="reader-icon" title="打开目录" aria-label="打开目录" onClick={() => setShowContents(true)}><List size={18} /></button>}
          <span className="markdown-toolbar__name" title={currentPath}>{currentPath.split('/').pop()}</span>
          <div className="markdown-toolbar__spacer" />
          <button type="button" className="reader-icon" title="搜索文档" aria-label="搜索文档" aria-expanded={showSearch} onClick={() => { setShowSearch(true); requestAnimationFrame(() => searchInput.current?.focus()); }}><Search size={18} /></button>
          <button type="button" className="reader-icon" title={wide ? '标准宽度' : '宽屏阅读'} aria-label={wide ? '标准宽度' : '宽屏阅读'} aria-pressed={wide} onClick={() => setWide((value) => !value)}>
            {wide ? <Columns2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
        {showSearch && (
          <div className="document-search">
            <Search size={16} aria-hidden="true" />
            <input ref={searchInput} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); } else if (event.key === 'Escape') closeSearch(); }} placeholder="搜索文档" aria-label="搜索当前文档" />
            <span className="document-search__count" aria-live="polite">{searchQuery.trim() ? matches.length ? `${matchIndex + 1} / ${matches.length}` : '无结果' : ''}</span>
            <button type="button" className="reader-icon" aria-label="上一个结果" title="上一个结果" disabled={!matches.length} onClick={() => moveMatch(-1)}><ChevronUp size={16} /></button>
            <button type="button" className="reader-icon" aria-label="下一个结果" title="下一个结果" disabled={!matches.length} onClick={() => moveMatch(1)}><ChevronDown size={16} /></button>
            <button type="button" className="reader-icon" aria-label="关闭搜索" title="关闭搜索" onClick={closeSearch}><X size={16} /></button>
          </div>
        )}
        <div className="markdown-scroll" ref={scroller} onScroll={updateActiveHeading}>
          <article ref={article} className={`markdown-document${wide ? ' markdown-document--wide' : ''}`} onClick={handleClick}>
            <Markdown remarkPlugins={remarkPlugins} rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], rehypeSlug]} components={components}>{content}</Markdown>
          </article>
        </div>
        </div>
    </div>
  );
}
