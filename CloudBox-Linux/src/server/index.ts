import { mkdirSync, rmSync } from 'node:fs';
import { closeDatabase, openDatabase } from '../core/db/connection.ts';
import { migrate } from '../core/db/migrator.ts';
import { createCoreServices } from '../core/container.ts';
import { logger, setLogLevel } from '../shared/logger.ts';
import { getAppVersion } from '../shared/version.ts';
import { createApp } from './app.ts';
import { loadServerConfig } from './config.ts';

function bootstrap(): void {
  const config = loadServerConfig();
  setLogLevel(config.logLevel);

  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.storageRoot, { recursive: true });

  // 单实例部署：启动时清理上次崩溃遗留的半截上传文件
  rmSync(config.tempDir, { recursive: true, force: true });
  mkdirSync(config.tempDir, { recursive: true });

  const db = openDatabase({ file: config.dbFile });
  const report = migrate(db);
  if (report.applied.length > 0) {
    logger.info(`已应用数据库迁移：${report.applied.join(', ')}`);
  }
  logger.info(`数据库就绪：${config.dbFile}（schema v${report.version}）`);

  const services = createCoreServices({
    db,
    storageRoot: config.storageRoot,
    tempDir: config.tempDir,
  });

  const app = createApp({ services, version: getAppVersion() });

  const server = app.listen(config.port, config.bind, () => {
    const host = config.bind === '0.0.0.0' || config.bind === '::' ? 'localhost' : config.bind;
    logger.info(`CloudBox 已启动：http://${host}:${config.port}/health`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`端口 ${config.port} 已被占用，请修改 PORT 或释放该端口`);
    } else if (error.code === 'EACCES') {
      logger.error(`无权监听端口 ${config.port}（请使用 1024 以上的端口）`);
    } else {
      logger.error('HTTP 服务启动失败', { code: error.code, message: error.message });
    }
    closeDatabase(db);
    process.exitCode = 1;
  });

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收到 ${signal}，正在关闭 CloudBox...`);

    const forceTimer = setTimeout(() => {
      logger.warn('关闭超时，强制退出');
      closeDatabase(db);
      process.exit(1);
    }, 5_000);
    forceTimer.unref();

    server.close((closeError) => {
      if (closeError) {
        logger.error('关闭 HTTP 服务时出错', { message: closeError.message });
      }
      closeDatabase(db);
      logger.info('CloudBox 已安全退出');
      process.exit(closeError ? 1 : 0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常，进程即将退出', { message: error.message, stack: error.stack });
    closeDatabase(db);
    process.exit(1);
  });
}

bootstrap();
