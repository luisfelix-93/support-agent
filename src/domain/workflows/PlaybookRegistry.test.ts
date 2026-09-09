import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlaybookRegistry } from './PlaybookRegistry.js';
import type { IInvestigationPlaybook } from './IInvestigationPlaybook.js';

describe('PlaybookRegistry', () => {
    let registry: PlaybookRegistry;

    const createMockPlaybook = (id: string, name: string, matchesResult: boolean): IInvestigationPlaybook => ({
        id,
        name,
        domain: 'test',
        description: `Playbook description for ${id}`,
        matches: vi.fn().mockReturnValue(matchesResult),
        getInvestigationPrompt: vi.fn().mockReturnValue(`Prompt for ${id}`),
        getRecommendedTools: vi.fn().mockReturnValue([`tool_${id}`]),
    });

    beforeEach(() => {
        registry = new PlaybookRegistry();
    });

    it('deve registrar e recuperar playbooks por id', () => {
        const pb = createMockPlaybook('api-error', 'API Error Playbook', true);
        registry.register(pb);

        expect(registry.has('api-error')).toBe(true);
        expect(registry.get('api-error')).toBe(pb);
        expect(registry.getAll()).toHaveLength(1);
    });

    it('deve lançar erro ao tentar registrar playbook sem id', () => {
        expect(() => {
            registry.register({} as any);
        }).toThrow('Playbook inválido ou sem identificador id.');
    });

    it('deve filtrar apenas playbooks que satisfazem o critério matches()', () => {
        const pb1 = createMockPlaybook('api-error', 'API Error', true);
        const pb2 = createMockPlaybook('latency', 'Latency Trace', false);
        const pb3 = createMockPlaybook('database', 'Database Pool', true);

        registry.register(pb1);
        registry.register(pb2);
        registry.register(pb3);

        const matches = registry.findMatchingPlaybooks('Mensagem de teste de erro 500 no banco');
        expect(matches).toHaveLength(2);
        expect(matches.map(p => p.id)).toEqual(['api-error', 'database']);
        expect(pb1.matches).toHaveBeenCalledWith('Mensagem de teste de erro 500 no banco', undefined);
        expect(pb2.matches).toHaveBeenCalledWith('Mensagem de teste de erro 500 no banco', undefined);
    });

    it('não deve quebrar a busca se um playbook lançar exceção no método matches', () => {
        const pbFailing: IInvestigationPlaybook = {
            id: 'failing',
            name: 'Failing Playbook',
            domain: 'test',
            description: 'Always throws',
            matches: vi.fn().mockImplementation(() => {
                throw new Error('Falha inesperada no matching');
            }),
            getInvestigationPrompt: vi.fn(),
            getRecommendedTools: vi.fn(),
        };

        const pbSuccess = createMockPlaybook('success', 'Success Playbook', true);

        registry.register(pbFailing);
        registry.register(pbSuccess);

        const matches = registry.findMatchingPlaybooks('Qualquer mensagem');
        expect(matches).toHaveLength(1);
        expect(matches[0].id).toBe('success');
    });

    it('deve limpar todos os playbooks com clear()', () => {
        registry.register(createMockPlaybook('pb-1', 'PB 1', true));
        expect(registry.getAll()).toHaveLength(1);

        registry.clear();
        expect(registry.getAll()).toHaveLength(0);
        expect(registry.has('pb-1')).toBe(false);
    });
});
