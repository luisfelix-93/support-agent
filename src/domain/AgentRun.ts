export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'max_iterations';

export interface ToolCallRecord {
    toolName: string;
    args?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
}

export class AgentRun {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly workspaceId: string,
        public readonly threadId: string,
        public status: AgentRunStatus = 'running',
        public iterations: number = 0,
        public toolCalls: ToolCallRecord[] = [],
        public readonly startedAt: Date = new Date(),
        public completedAt?: Date,
        public error?: string
    ) {}

    finish(status: AgentRunStatus, error?: string): void {
        this.status = status;
        this.completedAt = new Date();
        if (error) {
            this.error = error;
        }
    }

    recordToolCall(toolCall: ToolCallRecord): void {
        this.toolCalls.push(toolCall);
    }
}
