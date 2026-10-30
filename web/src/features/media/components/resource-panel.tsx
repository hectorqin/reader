import { Icon } from '../../../ui/icon.tsx';
import { useEffect, useState, type ReactNode } from 'react';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import { Sheet } from '../../../ui/sheet.tsx';
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
 * Resource details are rendered in a sheet. The legacy detail screen exposes
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
  const files = [...new Map(assets.map(asset => [asset.id, asset])).values()];
  const manage = !!(editionOptions?.onUpdated || editionOptions?.onAssigned || editionOptions?.onRename);

  useEffect(() => {
    setPanel(openPanel ?? null);
  }, [openPanel]);

  function open(value: ResourcePanelKind) {
    setPanel(value);
    onPanelChange?.(value);
  }

  function close() {
    setPanel(null);
    onPanelChange?.(null);
  }

  const modal = panel && (
    <Sheet
      className="media-modal"
      size="wide"
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
    </Sheet>
  );

  if (!showTrigger) return modal;
  return <>{modal}<section className="media-resource-panel media-resource-trigger">
    <header>
      <h2>资源信息</h2>
      <ActionMenu className="media-icon-button" label="资源信息操作" items={[
        files.length > 0 && { label: '资源信息', icon: <Icon name="file-text" size={16} />, onSelect: () => open('files') },
        (manage || !!versionPicker) && { label: manage ? '版本管理' : '播放版本', icon: <Icon name="versions" size={16} />, onSelect: () => open('versions') },
        !!sourceInfo && { label: '来源', icon: <Icon name="file-text" size={16} />, onSelect: () => open('source') },
      ]} />
    </header>
    <p>{summary}</p>
  </section></>;
}
