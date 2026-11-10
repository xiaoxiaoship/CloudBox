import { logger } from '../shared/logger.ts';
import type { FrpService } from './frpService.ts';
import type { ServerController } from './serverController.ts';

export interface ServerSchedule {
  enabled: boolean;
  start: string;
  end: string;
}

/**
 * 主进程内的轻量自动化：
 * - 按每日时间窗口自动启停 Web 服务
 * - 可选地把 frp 启停同步到 Web 服务状态
 */
export class ServiceAutomation {
  private readonly server: ServerController;
  private readonly frp: FrpService;
  private readonly settings: { get(key: string): unknown };
  private timer: NodeJS.Timeout | null = null;
  private lastServerRunning: boolean;
  private lastScheduleState: boolean | null = null;

  constructor(options: {
    server: ServerController;
    frp: FrpService;
    settings: { get(key: string): unknown };
  }) {
    this.server = options.server;
    this.frp = options.frp;
    this.settings = options.settings;
    this.lastServerRunning = this.server.getStatus().running;
    this.timer = setInterval(() => {
      void this.tick();
    }, 2_000);
  }

  getSchedule(): ServerSchedule {
    return {
      enabled: this.settings.get('server.scheduleEnabled') as boolean,
      start: this.settings.get('server.scheduleStart') as string,
      end: this.settings.get('server.scheduleEnd') as string,
    };
  }

  private inWindow(now: Date, start: string, end: string): boolean {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const current = now.getHours() * 60 + now.getMinutes();
    const from = sh! * 60 + sm!;
    const to = eh! * 60 + em!;
    if (from === to) return true;
    return from < to ? current >= from && current < to : current >= from || current < to;
  }

  private async tick(): Promise<void> {
    const schedule = this.getSchedule();
    if (schedule.enabled) {
      const shouldRun = this.inWindow(new Date(), schedule.start, schedule.end);
      const running = this.server.getStatus().running;
      if (shouldRun !== this.lastScheduleState || (shouldRun && !running) || (!shouldRun && running)) {
        this.lastScheduleState = shouldRun;
        try {
          if (shouldRun && !running) {
            await this.server.start(this.server.getStatus().port);
            logger.info('[schedule] Web 服务已按定时计划启动');
          } else if (!shouldRun && running) {
            await this.server.stop();
            logger.info('[schedule] Web 服务已按定时计划停止');
          }
        } catch (error) {
          logger.warn('[schedule] Web 服务定时启停失败', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else {
      this.lastScheduleState = null;
    }

    const running = this.server.getStatus().running;
    if (running !== this.lastServerRunning) {
      this.lastServerRunning = running;
      if (this.settings.get('frp.syncWithServer') === true) {
        try {
          if (running) {
            await this.frp.start();
            logger.info('[schedule] frp 已随 Web 服务启动');
          } else {
            await this.frp.stop();
            logger.info('[schedule] frp 已随 Web 服务停止');
          }
        } catch (error) {
          logger.warn('[schedule] frp 同步启停失败', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
