export class ToolCall {
    constructor(
        public readonly name: string,
        public readonly parameters: Record<string, any>
    ){}
}