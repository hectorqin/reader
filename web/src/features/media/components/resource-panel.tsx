import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ellipsis, FileText, Layers } from 'lucide-react';
import { Modal } from '../../../ui/modal.tsx';
import { ResourceInfo } from './resource-info.tsx';
import { EditionTools, type EditionDetailsProps } from './edition-details.tsx';
import type { MediaApi } from '../api/media-api.ts';

type ResourcePanelKind = 'files' | 'versions' | 'source';
type ResourcePanelProps = {
  api: MediaApi;
  assets: Array<{ id: string; title: string }>;
  summary: string;
  versionPicker?: ReactNode;
  sourceInfo?: ReactNode;
  openPanel?: ResourcePanelKind | null;
  onPanelChange?: (panel: ResourcePanelKind | null) => void;
  editionOptions?: EditionDetailsProps | undefined;
  showTrigger?: boolean;
};

/**
 * Resource details are rendered in a modal. The legacy detail screen exposes
 * the entry point from the page action menu, so the summary trigger is opt-in
 * for standalone consumers and hidden on the detail page.
 */
export function ResourcePanel({
  api,
  assets,
  summary,
  editionOptions,
  versionPicker,
  sourceInfo,
  openPanel,
  onPanelChange,
  showTrigger = true,
}: ResourcePanelProps) {
  const [panel, setPanel] = useState<ResourcePanelKind | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const files = [...new Map(assets.map(asset => [asset.id, asset])).values()];
  const manage = !!(editionOptions?.onUpdated || editionOptions?.onAssigned || editionOptions?.onRename);

  useEffect(() => {
    setPanel(openPanel ?? null);
  }, [openPanel]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  function open(value: ResourcePanelKind) {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus();
    }
    setPanel(value);
    onPanelChange?.(value);
  }

  function close() {
    setPanel(null);
    onPanelChange?.(null);
    menu.current?.querySelector('summary')?.focus();
  }

  const modal = panel && (
    <Modal
      className="media-modal"
      title={panel === 'files' ? '资源信息' : panel === 'source' ? '来源' : manage ? '版本管理' : '播放版本'}
      busy={!!editionOptions?.busy}
      onClose={close}
    >
      <div className="media-resource-dialog">
        {panel === 'files'
          ? files.length > 0 ? files.map(asset => <ResourceInfo key={asset.id} api={api} assetId={asset.id} title={asset.title} expanded />) : <p className="media-resource-empty">暂无资源。</p>
          : panel === 'source'
            ? sourceInfo
            : <>{versionPicker}{manage && editionOptions && <EditionTools {...editionOptions} managementOnly />}</>}
      </div>
    </Modal>
  );

  if (!showTrigger) return modal;
  return <>{modal}<section className="media-resource-panel media-resource-trigger" onClick={event => {
    if (event.target instanceof HTMLDialogElement && !editionOptions?.busy) {
      const rect = event.target.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }
  }}>
    <header>
      <h2>资源信息</h2>
      {(files.length > 0 || manage || versionPicker || sourceInfo) && <details className="media-actions" ref={menu} onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          menu.current!.open = false;
          menu.current!.querySelector('summary')?.focus();
        }
      }}>
        <summary aria-label="资源信息操作" title="资源信息操作"><Ellipsis size={19} aria-hidden="true" /></summary>
        <nav aria-label="资源信息操作">
          {files.length > 0 && <button onClick={() => open('files')}><FileText size={16} aria-hidden="true" />资源信息</button>}
          {(manage || versionPicker) && <button data-media-versions onClick={() => open('versions')}><Layers size={16} aria-hidden="true" />{manage ? '版本管理' : '播放版本'}</button>}
          {sourceInfo && <button onClick={() => open('source')}><FileText size={16} aria-hidden="true" />来源</button>}
        </nav>
      </details>}
    </header>
    <p>{summary}</p>
  </section></>;
}
