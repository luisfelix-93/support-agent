export type MessageRole = 'user' | 'assistant' | 'system';

export class Message {
    constructor(
        public readonly id: string,
        public readonly role: MessageRole,
        public readonly content: string,
        public readonly timestamp: Date = new Date()
    ) {}
}