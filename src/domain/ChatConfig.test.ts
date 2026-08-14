import { describe, it, expect } from 'vitest';
import { ChatConfig } from './ChatConfig.js';

describe('ChatConfig', () => {
    const validProps = {
        workspaceId: 'tenant-123',
        teamId: 'T0123456',
        botToken: 'xoxb-12345-67890',
        signingSecret: 'secret123',
    };

    it('deve instanciar ChatConfig com valores válidos', () => {
        const config = new ChatConfig(validProps);
        expect(config.workspaceId).toBe('tenant-123');
        expect(config.teamId).toBe('T0123456');
        expect(config.provider).toBe('slack');
        expect(config.botToken).toBe('xoxb-12345-67890');
        expect(config.signingSecret).toBe('secret123');
        expect(config.isActive).toBe(true);
        expect(config.createdAt).toBeInstanceOf(Date);
        expect(config.updatedAt).toBeInstanceOf(Date);
    });

    it('deve lançar erro quando workspaceId for vazio', () => {
        expect(() => new ChatConfig({ ...validProps, workspaceId: '' })).toThrow(
            '[ChatConfig] workspaceId é obrigatório.'
        );
    });

    it('deve lançar erro quando teamId for vazio', () => {
        expect(() => new ChatConfig({ ...validProps, teamId: '' })).toThrow(
            '[ChatConfig] teamId é obrigatório.'
        );
    });

    it('deve lançar erro quando botToken for vazio', () => {
        expect(() => new ChatConfig({ ...validProps, botToken: '' })).toThrow(
            '[ChatConfig] botToken é obrigatório.'
        );
    });

    it('deve lançar erro quando signingSecret for vazio', () => {
        expect(() => new ChatConfig({ ...validProps, signingSecret: '' })).toThrow(
            '[ChatConfig] signingSecret é obrigatório.'
        );
    });
});
