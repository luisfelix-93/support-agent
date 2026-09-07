import type { MessageRole } from "../Message.js";
import type { ToolCallRecord } from "../AgentRun.js";
import type { LLMCallRecord } from "../LLMCallRecord.js";

export interface EvaluationPayload {
    threadId?: string;
    userMessage?: string;
    finalResponse?: string;
    iterations: number;
    toolCalls: ToolCallRecord[];
    llmCalls?: LLMCallRecord[];
    totalTokens: number;
    costUsd: number;
    durationMs: number;
    memoriesInjected: number;
    agentVersion: string;
}

export interface IQueueService {
    // Envia a mensagem para processamento assíncrono
    dispatchMessageProcessing(workspaceId: string, threadId: string, content: string, source: 'google' | 'slack'): Promise<void>;
    
    // Envia o contexto recente para extração e promoção de memória em background
    dispatchMemoryPromotion(tenantId: string, workspaceId: string, threadId: string, messages: Array<{ role: MessageRole; content: string }>): Promise<void>;

    // Envia o run para auto-avaliação assíncrona em background
    dispatchEvaluation(
        runId: string,
        tenantId: string,
        workspaceId: string,
        payload: EvaluationPayload
    ): Promise<void>;
}