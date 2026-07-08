import type { LLMConfig } from "../../domain/LLMConfig.js";
import type { ILLMProvider } from "../../domain/ports/ILLMProvider.js";
import { AnthropicAdapter } from "./AnthropicAdapter.js";
import { GeminiAdapter } from "./GeminiAdapter.js";
import { OpenAIAdapter } from "./OpenAIAdapter.js";

export class LLMFactory {
    static create(config: LLMConfig) : ILLMProvider {
        switch (config.provider) {
            case 'openai':
                return new OpenAIAdapter(config.apiKey, config.model || 'gpt-4o');
            case 'deepseek':
                return new OpenAIAdapter(
                    config.apiKey,
                    config.model || 'deepseek-chat',
                    'https://api.deepseek.com'
                );
            case 'anthropic':
                return new AnthropicAdapter(config.apiKey, config.model || 'claude-3-5-sonnet');
            case 'google':
                return new GeminiAdapter(config.apiKey, config.model || 'gemini-2.0-flash');
            default:
                throw new Error(`Provedor LLM não suportado? ${config.provider}`)
        }
    }
}