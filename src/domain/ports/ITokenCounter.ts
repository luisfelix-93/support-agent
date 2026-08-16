import type { Message } from "../Message.js";

export interface ITokenCounter {
    countTokens(text: string): number;
    countMessagesTokens(messages: Message[]): number;
}
