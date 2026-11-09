import { GITLAB_ORIGIN } from './gitlab';

export interface Repository {
  projectPath: string;
  ref: string;
  filePath: string;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: 'tree' | 'blob';
}

async function resolveFromFileApi(projectPath: string, remainder: string): Promise<Pick<Repository, 'ref' | 'filePath'> | null> {
  const segments = remainder.split('/');
  for (let index = 1; index < segments.length; index++) {
    const ref = decodeURIComponent(segments.slice(0, index).join('/'));
    const filePath = decodeURIComponent(segments.slice(index).join('/'));
    const url = new URL(`/api/v4/projects/${encodeURIComponent(projectPath)}/repository/files/${encodeURIComponent(filePath)}`, GITLAB_ORIGIN);
    url.searchParams.set('ref', ref);
    const response = await fetch(url, { method: 'HEAD', credentials: 'include' });
    if (response.ok) return { ref, filePath };
    if (response.status === 401 || response.status === 403) throw new Error('无法读取 GitLab 仓库，请检查登录状态和访问权限。');
    if (response.status !== 404) throw new Error(`读取仓库信息失败（${response.status}）。`);
  }
  return null;
}

export async function resolveRepository(rawUrl: string, ref: string, filePath: string): Promise<Repository> {
  let source: URL;
  try {
    source = new URL(rawUrl);
  } catch {
    throw new Error('无法识别仓库地址，请从 GitLab 重新打开预览。');
  }
  const [project = '', remainder = ''] = source.pathname.split('/-/raw/');
  if (source.origin !== GITLAB_ORIGIN || !project || !remainder) throw new Error('无法识别仓库地址。');
  const projectPath = decodeURIComponent(project.replace(/^\//, ''));

  if (!ref || !filePath) {
    const blob = new URL(source.href);
    blob.pathname = blob.pathname.replace('/-/raw/', '/-/blob/');
    blob.hash = '';
    const response = await fetch(blob.href, { credentials: 'include' });
    if (!response.ok) throw new Error('无法读取仓库信息。');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (response.redirected && new URL(response.url).pathname.includes('/users/sign_in')) {
      throw new Error('GitLab 登录已失效，请重新登录。');
    }
    const header = page.querySelector<HTMLElement>('[data-blob-path][data-ref]');
    ref = header?.dataset.ref || page.querySelector<HTMLElement>('.js-project-refs-dropdown[data-ref], #js-ambiguous-ref-modal[data-ref]')?.dataset.ref || ref;
    filePath = header?.dataset.blobPath || filePath;
    if (!filePath && ref) {
      const decoded = decodeURIComponent(remainder);
      if (decoded.startsWith(`${ref}/`)) filePath = decoded.slice(ref.length + 1);
    }
    if (!ref || !filePath) {
      const resolved = await resolveFromFileApi(projectPath, remainder);
      if (resolved) ({ ref, filePath } = resolved);
    }
  }
  if (!ref || !filePath) throw new Error('无法识别当前分支，请从 GitLab 重新打开预览。');
  return { projectPath, ref, filePath };
}

export async function listTree(repository: Repository, path: string, recursive = false): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  let page = '1';
  do {
    const url = new URL(`/api/v4/projects/${encodeURIComponent(repository.projectPath)}/repository/tree`, GITLAB_ORIGIN);
    url.searchParams.set('ref', repository.ref);
    url.searchParams.set('path', path);
    if (recursive) url.searchParams.set('recursive', 'true');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', page);
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(response.status === 401 ? '请先登录 GitLab。' : '无法读取仓库目录。');
    const data: TreeEntry[] = await response.json();
    if (!Array.isArray(data)) throw new Error('无法读取仓库目录。');
    entries.push(...data);
    page = response.headers.get('x-next-page') ?? '';
  } while (page);
  return entries;
}

function repositoryFileUrl(repository: Repository, path: string, kind: 'raw' | 'blob'): string {
  const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/');
  return `${GITLAB_ORIGIN}/${encodePath(repository.projectPath)}/-/${kind}/${encodePath(repository.ref)}/${encodePath(path)}`;
}

export function rawFileUrl(repository: Repository, path: string): string {
  return repositoryFileUrl(repository, path, 'raw');
}

export function blobFileUrl(repository: Repository, path: string): string {
  return repositoryFileUrl(repository, path, 'blob');
}

export async function repositoryFileExists(repository: Repository, path: string): Promise<boolean> {
  const url = new URL(`/api/v4/projects/${encodeURIComponent(repository.projectPath)}/repository/files/${encodeURIComponent(path)}`, GITLAB_ORIGIN);
  url.searchParams.set('ref', repository.ref);
  const response = await fetch(url, { method: 'HEAD', credentials: 'include' });
  if (response.ok) return true;
  if (response.status === 404) return false;
  if (response.status === 401 || response.status === 403) throw new Error('无法读取 GitLab 仓库，请检查登录状态和访问权限。');
  throw new Error(`读取仓库文件失败（${response.status}）。`);
}
