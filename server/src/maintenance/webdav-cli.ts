import { uploadBackup } from './webdav.ts';
import {join} from 'node:path';
import {loadConfig} from '../config/index.ts';
import {MediaReadDatabase} from '../media/read-database.ts';
import {BusinessSettingsReader} from '../services/business-settings.ts';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const [directory, name, ...extra] = process.argv.slice(2);
if (!directory || !name || extra.length) {
  console.error('用法：node dist/maintenance/webdav-cli.js <已验证备份目录> <远端名称.zip>\n使用 DATA_DIR 对应实例在系统设置中保存的 WebDAV 配置。');
  process.exitCode = 1;
} else {
  const db=new MediaReadDatabase(join(loadConfig().dataDir,'reader.db'));
  const settings=new BusinessSettingsReader(db).read('webdav');db.close();
  uploadBackup(directory, { name,...settings,signal:controller.signal }).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
    // Network exceptions may contain destination URLs; keep credentials and URLs out of logs.
    console.error(controller.signal.aborted ? '备份上传已取消' : '备份上传失败，请检查备份校验、远端权限、配额、同名文件及 WebDAV 日志。');
    process.exitCode = 1;
  });
}
