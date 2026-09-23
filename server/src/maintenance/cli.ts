import { createBackup, restoreBackup, verifyBackup } from './backup.ts';

const HELP = `reader 离线数据维护（不包含 BOOKS_DIR 原书）
  backup <DATA_DIR> <新备份目录> --server-stopped
  verify <备份目录>
  restore <备份目录> <新DATA_DIR> --server-stopped

backup/restore 前必须停止使用该数据目录的所有服务和插件。
--server-stopped 是操作者确认，不是运行状态检测。目标目录必须不存在，父目录必须存在。
失败时保留带 .reader-backup-incomplete 的目录供检查，请勿启动该目录。`;

async function main(): Promise<void> {
  const [command, source, target, confirmation, ...extra] = process.argv.slice(2);
  if (!command || command === '--help') { console.log(HELP); return; }
  if (!source || extra.length || !['backup', 'verify', 'restore'].includes(command) ||
      (command === 'verify' ? !!target : !target || confirmation !== '--server-stopped')) {
    throw new Error(HELP);
  }
  const result = command === 'verify' ? await verifyBackup(source)
    : command === 'backup' ? await createBackup(source, target!) : await restoreBackup(source, target!);
  console.log(JSON.stringify({ operation: command, createdAt: result.createdAt,
    files: result.entries.filter(entry => entry.kind === 'file').length,
    bytes: result.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
    destination: target ?? source }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '数据维护失败');
  process.exitCode = 1;
});
