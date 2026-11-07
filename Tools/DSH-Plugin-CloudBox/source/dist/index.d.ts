export declare const name = "cloudbox";
/** DSH/Cordis 插件注入：等待 tools 服务可用后再 apply。 */
export declare const inject: string[];
export interface CloudBoxPluginConfig {
    cloudboxUrl: string;
    mcpToken: string;
    caCertPath?: string;
}
/**
 * DSH 插件入口。通过 Cordis 的 tools 服务注册 MCP 工具；
 * 同时把网盘路径约束注入 System Prompt。
 */
export declare function apply(ctx: {
    tools?: {
        register?: (tool: {
            name: string;
            description: string;
            inputSchema: unknown;
            execute: (args: unknown) => Promise<unknown>;
        }) => void;
        add?: (tool: unknown) => void;
        setSystemPrompt?: (prompt: string) => void;
    };
    systemPrompt?: {
        push?: (prompt: string) => void;
        prepend?: (prompt: string) => void;
    };
    logger?: {
        info?: (...args: unknown[]) => void;
        error?: (...args: unknown[]) => void;
    };
    effect?: (dispose: () => void) => void;
}, config?: CloudBoxPluginConfig): Promise<void>;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
