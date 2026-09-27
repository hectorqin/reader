import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from '../lib/errors.ts';

const run = promisify(execFile);
let active = 0;
/** Text extraction only. No video/audio encoding, network inputs or source writes. */
export async function extractEmbeddedSubtitle(path: string, index: number): Promise<Buffer> {
  if (!Number.isSafeInteger(index) || index < 0) throw new AppError(400, 'MEDIA_SUBTITLE_INVALID', '无效字幕轨道');
  if (active >= 2) throw new AppError(503, 'MEDIA_SUBTITLE_BUSY', '字幕提取繁忙，请稍后重试');
  active++;
  try {
    const { stdout } = await run(process.env.MEDIA_FFMPEG_PATH || 'ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
      '-format_whitelist', 'mov,matroska,webm', '-i', path, '-map', `0:${index}`,
      '-vn', '-an', '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1',
    ], { encoding: 'buffer', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch (error) {
    throw new AppError(422, 'MEDIA_SUBTITLE_EXTRACTION', (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? '服务器未配置 ffmpeg，无法提取内嵌字幕' : '内嵌字幕提取失败、超时或超过大小限制');
  } finally { active--; }
}
