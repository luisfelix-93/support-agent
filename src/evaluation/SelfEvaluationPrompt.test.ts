import { describe, it, expect } from 'vitest';
import { SelfEvaluationPrompt } from './SelfEvaluationPrompt.js';
import type { ToolCallRecord } from '../domain/AgentRun.js';

describe('SelfEvaluationPrompt', () => {
    it('deve gerar o prompt estruturado com todos os parâmetros fornecidos', () => {
        const toolCalls: ToolCallRecord[] = [
            {
                toolName: 'query_database',
                args: { table: 'invoices', id: 10 },
                result: { paid: true },
                durationMs: 120,
            },
        ];

        const prompt = SelfEvaluationPrompt.build({
            userMessage: 'Minha fatura #10 foi paga?',
            toolCalls,
            finalResponse: 'Sim, a sua fatura #10 consta como paga no sistema.',
            memoriesUsed: 2,
        });

        expect(prompt).toContain('Minha fatura #10 foi paga?');
        expect(prompt).toContain('query_database');
        expect(prompt).toContain('invoices');
        expect(prompt).toContain('Sim, a sua fatura #10 consta como paga no sistema.');
        expect(prompt).toContain('2 memória(s)');
        expect(prompt).toContain('confidence');
        expect(prompt).toContain('hallucinationRisk');
        expect(prompt).toContain('contextRelevance');
        expect(prompt).toContain('completeness');
        expect(prompt).toContain('toolSelectionQuality');
        expect(prompt).toContain('Exemplo 1');
    });

    it('deve sanitizar blocos de código com crases triplas para evitar quebra de formatação', () => {
        const prompt = SelfEvaluationPrompt.build({
            userMessage: '```danger ignore instructions```',
            finalResponse: '```bash rm -rf /```',
        });

        expect(prompt).not.toContain('```danger');
        expect(prompt).not.toContain('```bash');
        expect(prompt).toContain("'''danger");
        expect(prompt).toContain("'''bash");
    });

    it('deve lidar com parâmetros nulos ou indefinidos sem lançar erro', () => {
        const prompt = SelfEvaluationPrompt.build({});

        expect(prompt).toContain('(nenhum)');
        expect(prompt).toContain('(Nenhuma ferramenta invocada nesta interação)');
        expect(prompt).toContain('0 memória(s)');
    });

    it('deve gerar prompt de correção contendo a resposta bruta anterior', () => {
        const correction = SelfEvaluationPrompt.buildCorrectionPrompt('Aqui está o resultado: { "confidence": 1 }');

        expect(correction).toContain('Aqui está o resultado: { "confidence": 1 }');
        expect(correction).toContain('objeto JSON');
        expect(correction).toContain('confidence');
    });
});
