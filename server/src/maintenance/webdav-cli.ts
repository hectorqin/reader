import { uploadBackup } from './webdav.ts';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const [directory, name, ...extra] = process.argv.slice(2);
if (!directory || !name || extra.length) {
  console.error('用法：node dist/maintenance/webdav-cli.js <已验证备份目录> <远端名称.zip>\n环境变量：WEBDAV_URL、WEBDAV_USERNAME、WEBDAV_PASSWORD；可选 WEBDAV_MAX_BYTES。');
  process.exitCode = 1;
} else {
  uploadBackup(directory, { name, url: process.env.WEBDAV_URL ?? '', username: process.env.WEBDAV_USERNAME ?? '',
    password: process.env.WEBDAV_PASSWORD ?? '', signal: controller.signal,
    ...(process.env.WEBDAV_MAX_BYTES ? { maxBytes: Number(process.env.WEBDAV_MAX_BYTES) } : {}),
  }).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
    // Network exceptions may contain destination URLs; keep credentials and URLs out of logs.
    console.error(controller.signal.aborted ? '备份上传已取消' : '备份上传失败，请检查备份校验、远端权限、配额、同名文件及 WebDAV 日志。');
    process.exitCode = 1;
  });
}
