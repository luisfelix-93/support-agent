import type { ChatContext } from "../ChatContext.js";
import type { ILLMProvider } from "./ILLMProvider.js";
import type { IMCPClient } from "./IMCPClient.js";
import type { ToolCallRecord } from "../AgentRun.js";

import type { EvidenceLedger } from "../workflows/EvidenceLedger.js";

export interface AgentRunInput {
    tenantId: string;
    workspaceId: string;
    threadId: string;
    userMessage: string;
    context: ChatContext;
    llmProvider: ILLMProvider;
    mcpClient: IMCPClient;
    tools?: any[];
    systemInstructions?: string;
    playbookIds?: string[];
    evidenceLedger?: EvidenceLedger;
}

export interface AgentRunResult {
    runId: string;
    response: string;
    iterations: number;
    toolCalls: ToolCallRecord[];
    status: 'completed' | 'failed' | 'max_iterations';
    durationMs: number;
    error?: string;
    playbookIds?: string[];
}

export interface IAgentHarness {
    run(input: AgentRunInput): Promise<AgentRunResult>;
}
