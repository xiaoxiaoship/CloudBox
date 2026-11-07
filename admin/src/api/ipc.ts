import type { CloudboxApi, Result } from '../../../src/shared/ipcTypes.ts';

const bridge = (window as unknown as { cloudbox?: CloudboxApi }).cloudbox;

export const bridgeAvailable = typeof bridge !== 'undefined';
export const api = bridge as CloudboxApi;

export class IpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

export async function call<T>(operation: Promise<Result<T>>): Promise<T> {
  const result = await operation;
  if (!result.ok) {
    throw new IpcError(result.code, result.message);
  }
  return result.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试';
}
