import { logger, setLogLevel } from '../shared/logger.ts';
import { createHeadlessController, HeadlessServiceError, type ServiceController } from './serviceController.ts';

async function main(): Promise<void> {
  setLogLevel(process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info');
  let controller: ServiceController | null = null;
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收到 ${signal}，正在关闭 CloudBox headless 服务...`);
    await controller?.close().catch((error: unknown) => {
      logger.error('关闭 headless 服务失败', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    process.exit(0);
  };

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  try {
    controller = createHeadlessController();
    await controller.start();
  } catch (error) {
    if (error instanceof HeadlessServiceError) {
      logger.error(error.message, { code: error.code });
    } else {
      logger.error('headless 服务启动失败', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await controller?.close().catch(() => {});
    process.exitCode = 1;
    process.exit(1);
  }

  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常，进程即将退出', { message: error.message, stack: error.stack });
    process.exit(1);
  });
}

void main();
