export type LLMProviderType = 'openai' | 'anthropic' | 'google'| 'deepseek'

export interface LLMConfig {
    provider: LLMProviderType;
    apiKey: string;
    model?: string
}