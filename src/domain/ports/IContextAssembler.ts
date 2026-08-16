import type { ChatContext } from "../ChatContext.js";
import type { Memory } from "../Memory.js";
import type { Message } from "../Message.js";

export interface ContextAssemblyOptions {
    systemInstructions?: string;
    maxTokens?: number;
    memories?: Memory[];
    recentMessages?: Message[];
}

export interface IContextAssembler {
    assemble(
        context: ChatContext,
        options?: ContextAssemblyOptions
    ): Promise<ChatContext>;
}
