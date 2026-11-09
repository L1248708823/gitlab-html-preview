import { GITLAB_ORIGIN } from './gitlab';
import { rawFileUrl, repositoryFileExists, type Repository } from './repository';

export interface RepositoryLink {
  path: string;
  hash: string;
  search: string;
  originalUrl: string;
  relativePath?: string;
  outsideRepository: boolean;
  absolute: boolean;
}

type LinkRule = (link: RepositoryLink, repository: Repository) => string | null;

const linkRules: LinkRule[] = [
  (link, repository) => {
    if (!link.relativePath) return null;
    const segments = link.relativePath.split('/');
    const projectName = repository.projectPath.split('/').pop();
    let index = 0;
    while (segments[index] === '..' || segments[index] === '.') index++;
    if (segments[index] !== 'CodeBuddy' || segments[index + 1] !== projectName) return null;
    const candidate = segments.slice(index + 2);
    if (!candidate.length || candidate.some((segment) => segment === '..')) return null;
    return candidate.filter((segment) => segment && segment !== '.').join('/');
  },
];

function pathFromUrl(pathname: string): string {
  return pathname.split('/').map((segment) => decodeURIComponent(segment)).join('/');
}

export function parseRepositoryLink(href: string, repository: Repository, currentPath: string): RepositoryLink | null {
  try {
    const originalUrl = new URL(href, rawFileUrl(repository, currentPath));
    const isAbsolute = /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(href);
    if (isAbsolute) {
      if (originalUrl.origin !== GITLAB_ORIGIN) return null;
      const project = `/${repository.projectPath}`;
      const pathname = pathFromUrl(originalUrl.pathname);
      const roots = [`${project}/-/raw/${repository.ref}/`, `${project}/-/blob/${repository.ref}/`];
      const root = roots.find((value) => pathname.startsWith(value));
      if (!root) return null;
      return {
        path: pathname.slice(root.length),
        hash: originalUrl.hash,
        search: originalUrl.search,
        originalUrl: originalUrl.href,
        outsideRepository: false,
        absolute: true,
      };
    }

    const relative = new URL(href, 'https://repository.invalid/' + currentPath.split('/').map(encodeURIComponent).join('/'));
    const relativePath = pathFromUrl(href.split(/[?#]/, 1)[0] ?? '');
    const depth = currentPath.split('/').length - 1;
    let level = depth;
    let outsideRepository = false;
    for (const segment of relativePath.split('/')) {
      if (segment === '..') {
        if (level === 0) outsideRepository = true;
        else level--;
      } else if (segment && segment !== '.') {
        level++;
      }
    }
    return {
      path: pathFromUrl(relative.pathname.replace(/^\//, '')),
      hash: relative.hash,
      search: relative.search,
      originalUrl: originalUrl.href,
      relativePath,
      outsideRepository,
      absolute: false,
    };
  } catch {
    return null;
  }
}

export async function resolveRepositoryLink(link: RepositoryLink, repository: Repository): Promise<string | null> {
  if (link.absolute) return link.path;
  if (!link.outsideRepository && await repositoryFileExists(repository, link.path)) return link.path;
  for (const rule of linkRules) {
    const candidate = rule(link, repository);
    if (candidate && await repositoryFileExists(repository, candidate)) return candidate;
  }
  return null;
}
