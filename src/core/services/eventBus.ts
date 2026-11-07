export type CoreEvent =
  | 'file.uploaded'
  | 'file.deleted'
  | 'user.registered'
  | 'user.created'
  | 'security.alert'
  | 'system.error';

export type CoreEventHandler = (payload: Record<string, unknown>) => void;

/** 进程内事件总线；插件子进程通过 PluginService 桥接核心事件。 */
export class EventBus {
  private readonly handlers = new Map<CoreEvent, Set<CoreEventHandler>>();

  on(event: CoreEvent, handler: CoreEventHandler): () => void {
    const set = this.handlers.get(event) ?? new Set<CoreEventHandler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  emit(event: CoreEvent, payload: Record<string, unknown>): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch {
        // 事件订阅者不应影响核心流程
      }
    }
  }
}
