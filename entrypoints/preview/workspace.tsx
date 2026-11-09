import { ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen, LoaderCircle, PanelRightClose, PanelRightOpen, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { blobFileUrl, listTree, rawFileUrl, type Repository, type TreeEntry } from '../../lib/repository';

const DEFAULT_WIDTH = 284;
const MIN_WIDTH = 220;
const WIDTH_STORAGE_KEY = 'workspace-width';

type Directory = { status: 'loading' } | { status: 'loaded'; entries: TreeEntry[] } | { status: 'error' };
type SearchIndex = { status: 'idle' } | { status: 'loading' } | { status: 'loaded'; entries: TreeEntry[] } | { status: 'error' };

interface WorkspaceProps {
  repository: Repository | null;
  error: string;
  currentPath: string;
  onSelect: (url: string, path: string) => void;
}

export function Workspace({ repository, error, currentPath, onSelect }: WorkspaceProps) {
  const [directories, setDirectories] = useState<Record<string, Directory>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [hidden, setHidden] = useState(false);
  const [query, setQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState<SearchIndex>({ status: 'idle' });
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [searchStarted, setSearchStarted] = useState(false);
  const [preferredWidth, setPreferredWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_WIDTH;
  });
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const maxWidth = Math.floor(viewportWidth - Math.min(320, viewportWidth / 2));
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const width = Math.max(minWidth, Math.min(preferredWidth, maxWidth));

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  useEffect(() => {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(preferredWidth));
  }, [preferredWidth]);

  function resize(nextWidth: number) {
    setPreferredWidth(Math.max(minWidth, Math.min(Math.round(nextWidth), maxWidth)));
  }

  async function load(path: string) {
    if (!repository) return;
    setDirectories((current) => ({ ...current, [path]: { status: 'loading' } }));
    try {
      const entries = await listTree(repository, path);
      setDirectories((current) => ({ ...current, [path]: { status: 'loaded', entries } }));
    } catch {
      setDirectories((current) => ({ ...current, [path]: { status: 'error' } }));
    }
  }

  useEffect(() => {
    if (!repository) return;
    const segments = repository.filePath.split('/').slice(0, -1);
    const parents = [''];
    for (let i = 0; i < segments.length; i++) parents.push(segments.slice(0, i + 1).join('/'));
    setExpanded(new Set(parents));
    setDirectories({});
    parents.forEach((path) => void load(path));
    setSearchIndex({ status: 'idle' });
    setQuery('');
    setSearchStarted(false);
  }, [repository?.projectPath, repository?.ref]);

  useEffect(() => {
    if (!repository || !searchStarted) return;
    let cancelled = false;
    setSearchIndex({ status: 'loading' });
    listTree(repository, '', true).then(
      (entries) => { if (!cancelled) setSearchIndex({ status: 'loaded', entries: entries.filter((entry) => entry.type === 'blob') }); },
      () => { if (!cancelled) setSearchIndex({ status: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [repository?.projectPath, repository?.ref, searchStarted, searchAttempt]);

  useEffect(() => {
    if (!repository || currentPath === repository.filePath) return;
    const segments = currentPath.split('/').slice(0, -1);
    const parents = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
    setExpanded((current) => new Set([...current, ...parents]));
    parents.forEach((path) => { if (!directories[path]) void load(path); });
  }, [currentPath]);

  function toggleFolder(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!directories[path] || directories[path].status === 'error') void load(path);
  }

  function renderDirectory(path: string, depth: number) {
    const directory = directories[path];
    if (!directory || directory.status === 'loading') {
      return <div className="tree-message" style={{ paddingLeft: 16 + depth * 12 }}><LoaderCircle className="tree-spinner" size={15} />加载中</div>;
    }
    if (directory.status === 'error') {
      return <button className="tree-message tree-retry" style={{ paddingLeft: 16 + depth * 12 }} onClick={() => void load(path)}>加载失败，点击重试</button>;
    }
    if (!directory.entries.length) return <div className="tree-message" style={{ paddingLeft: 16 + depth * 12 }}>空文件夹</div>;
    return directory.entries.map((entry) => {
      const isFolder = entry.type === 'tree';
      const isHtml = /\.html?$/i.test(entry.name);
      const isPreviewable = /\.(?:html?|md)$/i.test(entry.name);
      const isOpen = expanded.has(entry.path);
      const isActive = entry.path === currentPath;
      const Icon = isFolder ? (isOpen ? FolderOpen : Folder) : (isHtml ? FileCode2 : FileText);
      return (
        <div key={entry.path}>
          {isFolder || isPreviewable ? (
            <button
              className={`tree-item${isActive ? ' tree-item--active' : ''}`}
              style={{ paddingLeft: 14 + depth * 12 }}
              onClick={() => isFolder ? toggleFolder(entry.path) : repository && onSelect(rawFileUrl(repository, entry.path), entry.path)}
              aria-expanded={isFolder ? isOpen : undefined}
              aria-current={isActive ? 'page' : undefined}
              title={entry.name}
            >
              {isFolder ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="tree-item__spacer" />}
              <Icon className="tree-item__icon" size={16} strokeWidth={1.6} />
              <span className="tree-item__name">{entry.name}</span>
            </button>
          ) : (
            <a
              className="tree-item"
              style={{ paddingLeft: 14 + depth * 12 }}
              href={repository ? blobFileUrl(repository, entry.path) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={entry.name}
            >
              <span className="tree-item__spacer" /><Icon className="tree-item__icon" size={16} strokeWidth={1.6} /><span className="tree-item__name">{entry.name}</span>
            </a>
          )}
          {isFolder && isOpen && renderDirectory(entry.path, depth + 1)}
        </div>
      );
    });
  }

  function renderSearchResults() {
    if (searchIndex.status === 'idle' || searchIndex.status === 'loading') {
      return <div className="tree-message tree-search-message"><LoaderCircle className="tree-spinner" size={15} />搜索中</div>;
    }
    if (searchIndex.status === 'error') {
      return <button className="tree-message tree-search-message tree-retry" type="button" onClick={() => setSearchAttempt((value) => value + 1)}>加载失败，点击重试</button>;
    }
    const results = searchIndex.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    if (!results.length) return <div className="tree-message tree-search-message">没有找到文件</div>;
    return results.map((entry) => {
      const isHtml = /\.html?$/i.test(entry.name);
      const isPreviewable = /\.(?:html?|md)$/i.test(entry.name);
      const Icon = isHtml ? FileCode2 : FileText;
      const content = <><Icon className="tree-item__icon" size={16} strokeWidth={1.6} /><span className="tree-search-result__text"><span className="tree-item__name">{entry.name}</span><span className="tree-search-result__path">{entry.path}</span></span></>;
      return isPreviewable ? (
        <button key={entry.path} type="button" className={`tree-item tree-search-result${entry.path === currentPath ? ' tree-item--active' : ''}`} title={entry.path} aria-current={entry.path === currentPath ? 'page' : undefined} onClick={() => { if (repository) onSelect(rawFileUrl(repository, entry.path), entry.path); }}>
          {content}
        </button>
      ) : (
        <a key={entry.path} className="tree-item tree-search-result" title={entry.path} href={repository ? blobFileUrl(repository, entry.path) : undefined} target="_blank" rel="noopener noreferrer">{content}</a>
      );
    });
  }

  if (hidden) return <button className="workspace-toggle" type="button" onClick={() => setHidden(false)} aria-label="打开文件栏" title="打开文件栏"><PanelRightOpen size={19} strokeWidth={1.6} /></button>;

  return (
    <aside id="workspace" className="workspace" aria-label="仓库文件" style={{ width }}>
      <div
        className="workspace__resize"
        role="separator"
        tabIndex={0}
        aria-label="调整文件栏宽度"
        aria-controls="workspace"
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        aria-valuetext={`${width} 像素`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId === event.pointerId) resize(drag.current.startWidth + drag.current.startX - event.clientX);
        }}
        onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') resize(width + 10);
          else if (event.key === 'ArrowRight') resize(width - 10);
          else if (event.key === 'Home') resize(minWidth);
          else if (event.key === 'End') resize(maxWidth);
          else return;
          event.preventDefault();
        }}
      />
      <div className="workspace__header">
        <span>文件</span>
        <button className="workspace__icon-button" type="button" onClick={() => setHidden(true)} aria-label="收起文件栏" title="收起文件栏"><PanelRightClose size={18} strokeWidth={1.6} /></button>
      </div>
      {repository && (
        <div className="workspace__repo" title={`${repository.projectPath} · ${repository.ref}`}>
          <span className="workspace__repo-name">{repository.projectPath.split('/').pop()}</span>
          <span className="workspace__branch">{repository.ref}</span>
        </div>
      )}
      {repository && (
        <div className="workspace__search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (value.trim()) setSearchStarted(true); }} placeholder="搜索文件名" aria-label="搜索仓库文件名" />
          {query && <button type="button" aria-label="清除文件搜索" title="清除" onClick={() => setQuery('')}><X size={15} /></button>}
        </div>
      )}
      <nav className="workspace__tree" aria-label="仓库目录">
        {error ? <p className="workspace__error">{error}</p> : repository ? query.trim() ? renderSearchResults() : renderDirectory('', 0) : <div className="tree-message"><LoaderCircle className="tree-spinner" size={15} />加载中</div>}
      </nav>
    </aside>
  );
}
