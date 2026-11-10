import { useEffect, useState, type JSX } from 'react';
import { describeError } from '../../../api/errors.ts';
import type { BrowseListing } from '../../../api/types.ts';
import { Icon } from '../../../ui/icon.tsx';
import { Sheet } from '../../../ui/sheet.tsx';
import { Button } from '../../../ui/toolkit.tsx';

/** A folder's sub-folders, however many listing pages they were spread over. */
export interface FolderChoices {
  crumbs: BrowseListing['crumbs'];
  dirs: Array<{ name: string; path: string }>;
  writable: boolean;
}

/** More pages than this is a folder nobody picks from by scrolling; the cap bounds the loop. */
const MAX_PAGES = 25;

/**
 * Every sub-folder of `path`. The listing is sorted by name with files and folders
 * mixed and paged by the server, so the folders of a large directory are spread
 * over all of its pages; the picker needs all of them, not the first page's share.
 */
export async function loadFolderChoices(
  browse: (path: string, page: number, options: { signal: AbortSignal }) => Promise<BrowseListing>,
  path: string,
  signal: AbortSignal,
): Promise<FolderChoices> {
  const first = await browse(path, 1, { signal });
  const dirs = first.entries.filter(entry => entry.type === 'dir');
  let seen = first.entries.length;
  for (let page = 2; seen < first.total && dirs.length < first.dirs && page <= MAX_PAGES; page++) {
    const next = await browse(path, page, { signal });
    if (next.entries.length === 0) break;
    seen += next.entries.length;
    dirs.push(...next.entries.filter(entry => entry.type === 'dir'));
  }
  return { crumbs: first.crumbs, dirs: dirs.map(({ name, path: dirPath }) => ({ name, path: dirPath })), writable: first.writable };
}

/**
 * 移动到: pick the destination by walking the library, instead of typing its path.
 *
 * It opens on the folder the items are in, because the common move is into a
 * sibling or a child. The answer is the folder being shown — "移动到这里" — so there
 * is no separate selection to keep in step with the listing. A folder that is itself
 * being moved cannot be entered (it cannot contain itself), and the folder the items
 * already live in is not offered as a destination.
 */
export function FolderPicker({ moving, from, load, onPick, onClose }: {
  /** Library-relative paths being moved; all of them live in `from`. */
  moving: string[];
  from: string;
  load(path: string, signal: AbortSignal): Promise<FolderChoices>;
  onPick(target: string): void;
  onClose(): void;
}): JSX.Element {
  const [path, setPath] = useState(from);
  const [state, setState] = useState<{ path: string; choices?: FolderChoices; error?: unknown }>({ path: from });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ path });
    load(path, controller.signal).then(
      choices => { if (!controller.signal.aborted) setState({ path, choices }); },
      error => { if (!controller.signal.aborted) setState({ path, error }); },
    );
    return () => controller.abort();
  }, [path, attempt, load]);

  const choices = state.path === path ? state.choices : undefined;
  const error = state.path === path ? state.error : undefined;
  const here = choices?.crumbs.at(-1)?.name ?? '书库';
  const reason = !choices ? ''
    : path === from ? '要移动的内容已经在这个文件夹里'
    : !choices.writable ? '这个文件夹只读，不能移入'
    : '';
  return <Sheet title={moving.length === 1 ? `移动「${moving[0]!.split('/').pop()}」` : `移动 ${moving.length} 项`} onClose={onClose} className="folder-picker"
    footer={<>
      <Button onClick={onClose}>取消</Button>
      <Button className="primary" disabled={!choices || !!reason} onClick={() => onPick(path)}>移动到这里</Button>
    </>}>
    <nav className="manager-crumbs folder-picker-crumbs" aria-label="目标位置">
      {(choices?.crumbs ?? [{ name: '书库', path: '' }]).map((crumb, index, all) => <span key={`${crumb.path}-${index}`}>
        {index > 0 && <span className="manager-crumb-sep">/</span>}
        <button type="button" className="manager-crumb" aria-current={index === all.length - 1 ? 'location' : undefined} onClick={() => setPath(crumb.path)}>{crumb.name}</button>
      </span>)}
    </nav>
    {!choices && !error && <p className="folder-picker-note muted" role="status">正在读取文件夹…</p>}
    {error !== undefined && <p className="folder-picker-note notice error" role="alert">{describeError(error, '文件夹读取失败')} <button type="button" className="button" onClick={() => setAttempt(value => value + 1)}>重试</button></p>}
    {choices && (choices.dirs.length === 0
      ? <p className="folder-picker-note muted">「{here}」里没有子文件夹</p>
      : <ul className="folder-picker-list">{choices.dirs.map(dir => {
        const self = moving.includes(dir.path);
        return <li key={dir.path}><button type="button" className="folder-picker-row" disabled={self} onClick={() => setPath(dir.path)}>
          <Icon name="folder" size={20} /><span>{dir.name}</span>{self ? <small>正在移动</small> : <Icon name="chevron-right" size={16} />}
        </button></li>;
      })}</ul>)}
    {reason && <p className="folder-picker-note muted" role="status">{reason}</p>}
  </Sheet>;
}
