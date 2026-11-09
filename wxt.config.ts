import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'GitLab HTML 预览',
    description: '在新标签页中预览 GitLab 上的 HTML 和 Markdown 文件。',
    version: '0.1.0',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    host_permissions: ['https://gitlab.goktech.cn/*'],
    sandbox: { pages: ['sandbox.html'] },
    content_security_policy: {
      sandbox: "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; script-src 'self' chrome-extension: 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline' data: blob:; img-src data: blob: https:; font-src data: blob: https:; media-src data: blob: https:; connect-src https:;",
    },
  },
});
