import { afterEach } from 'vitest';
import { dismissAllNotices } from '../../src/ui/notifications.ts';

export const visibleNotices = () => [...document.querySelectorAll<HTMLElement>('.global-notice:not(.notyf__toast--disappear)')];
export const noticeText = () => visibleNotices().map(node => node.textContent).join('\n');
afterEach(() => dismissAllNotices());
