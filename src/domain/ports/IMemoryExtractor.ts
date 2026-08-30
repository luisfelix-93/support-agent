import type { Memory } from "../Memory.js";
import type { Message } from "../Message.js";
import type { ILLMProvider } from "./ILLMProvider.js";

export interface MemoryExtractionInput {
    tenantId: string;
    workspaceId: string;
    threadId: string;
    messages: Message[];
    llmProvider: ILLMProvider;
}

export interface IMemoryExtractor {
    extract(input: MemoryExtractionInput): Promise<Memory[]>;
}
