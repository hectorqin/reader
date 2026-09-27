import type { MediaDatabase } from './read-database.ts';
import { notFound } from '../lib/errors.ts';
import { MediaLibraries } from './libraries.ts';
import type { MediaActor } from './libraries.ts';
import { RemoteArtwork } from './remote-artwork.ts';
import { EmbeddedArtwork } from './embedded-artwork.ts';
import type { MediaTechnicalInfo } from './probe.ts';

const MAX_COVER_BYTES = 20 * 1024 * 1024;

/** Raster sidecars only; clients select an item, never a filesystem path. */
export class MediaArtwork {
  private readonly embedded=new EmbeddedArtwork();
  constructor(private readonly db:MediaDatabase, private readonly libraries: MediaLibraries, private readonly remote=new RemoteArtwork()) {}

  async cover(actor: MediaActor, itemId: string) {
    const row = this.db.get<{ library_id: string; metadata_json: string }>('SELECT library_id,metadata_json FROM media_items WHERE id=?', itemId);
    if (!row) throw notFound('media cover not found');
    this.libraries.get(actor, row.library_id);
    const metadata = JSON.parse(row.metadata_json) as { coverRef?: string;embeddedCoverAssetId?:string };
    let bytes: Buffer;
    if(typeof metadata.coverRef!=='string'&&typeof metadata.embeddedCoverAssetId==='string'){
      const asset=this.db.get<{ref:string;technical_json:string}>('SELECT ref,technical_json FROM media_assets WHERE id=? AND library_id=? AND available=1',metadata.embeddedCoverAssetId,row.library_id);
      if(!asset)throw notFound('media cover unavailable');
      const info=JSON.parse(asset.technical_json) as MediaTechnicalInfo;
      const picture=info.streams.find(stream=>stream.attachedPicture&&['mjpeg','png','webp'].includes(stream.codec));
      if(!picture)throw notFound('media cover unavailable');
      const storage=await this.libraries.storage(actor,row.library_id),before=await storage.stat(asset.ref);
      const key=JSON.stringify([row.library_id,metadata.embeddedCoverAssetId,asset.ref,before.fileIdentity,before.size,before.modifiedAt,picture.index]);
      if(!storage.filePath)throw notFound('embedded artwork is unavailable for this storage');
      bytes=await this.embedded.read(key,await storage.filePath(asset.ref),picture.index);
      const after=await storage.stat(asset.ref);
      const latest=this.db.get<{metadata_json:string}>('SELECT metadata_json FROM media_items WHERE id=?',itemId);
      const latestAsset=this.db.get<{ref:string;technical_json:string}>('SELECT ref,technical_json FROM media_assets WHERE id=? AND library_id=? AND available=1',metadata.embeddedCoverAssetId,row.library_id);
      if(before.size!==after.size||before.modifiedAt!==after.modifiedAt||before.fileIdentity!==after.fileIdentity||latest?.metadata_json!==row.metadata_json||latestAsset?.ref!==asset.ref||latestAsset?.technical_json!==asset.technical_json)throw notFound('media cover changed');
    }else if(typeof metadata.coverRef!=='string'){
      const online=this.db.get<{provider:string;fields_json:string}>("SELECT provider,fields_json FROM media_online_metadata WHERE item_id=? AND provider IN ('tmdb','musicbrainz')",itemId);
      const field=online?.provider==='musicbrainz'?'musicBrainzCoverGroupId':'tmdbPosterPath';
      const path=online?(JSON.parse(online.fields_json) as Record<string,unknown>)[field]:undefined;
      if(typeof path!=='string')throw notFound('media cover not found');
      bytes=online!.provider==='musicbrainz'?await this.remote.musicBrainz(path):await this.remote.tmdb(path);
      const latest=this.db.get<{provider:string;fields_json:string}>("SELECT provider,fields_json FROM media_online_metadata WHERE item_id=?",itemId);
      if(!latest||latest.provider!==online!.provider||(JSON.parse(latest.fields_json) as Record<string,unknown>)[field]!==path)throw notFound('media cover changed');
    }else{
    const storage = await this.libraries.storage(actor, row.library_id);
    try {
      const entry = await storage.stat(metadata.coverRef);
      if (entry.size <= 0 || entry.size > MAX_COVER_BYTES) throw notFound('media cover not found');
      const { stream } = await storage.open(metadata.coverRef);
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_COVER_BYTES) { stream.destroy(); throw notFound('media cover not found'); }
        chunks.push(Buffer.from(chunk));
      }
      bytes = Buffer.concat(chunks);
    } catch {
      // Do not leak sidecar names, mount locations or filesystem errors.
      throw notFound('media cover unavailable', 'MEDIA_COVER_UNAVAILABLE');
    }
    }
    let contentType: string;
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) contentType = 'image/jpeg';
    else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) contentType = 'image/png';
    else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') contentType = 'image/webp';
    else throw notFound('media cover format unsupported', 'MEDIA_COVER_UNAVAILABLE');
    this.libraries.get(actor, row.library_id);
    return { bytes, contentType };
  }
}
