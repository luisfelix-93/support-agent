import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { getAgentVersion, resetAgentVersionCache, DEFAULT_AGENT_VERSION } from './version.js';

describe('getAgentVersion', () => {
    const originalAgentVersion = process.env.AGENT_VERSION;
    const originalNpmVersion = process.env.npm_package_version;

    beforeEach(() => {
        resetAgentVersionCache();
        delete process.env.AGENT_VERSION;
        delete process.env.npm_package_version;
        vi.restoreAllMocks();
    });

    afterEach(() => {
        resetAgentVersionCache();
        if (originalAgentVersion !== undefined) {
            process.env.AGENT_VERSION = originalAgentVersion;
        } else {
            delete process.env.AGENT_VERSION;
        }

        if (originalNpmVersion !== undefined) {
            process.env.npm_package_version = originalNpmVersion;
        } else {
            delete process.env.npm_package_version;
        }
        vi.restoreAllMocks();
    });

    it('deve extrair a versão do package.json na raiz do projeto', () => {
        const rawPackage = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
        const version = getAgentVersion();
        expect(version).toBe(rawPackage.version);
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('deve priorizar a variável de ambiente AGENT_VERSION se configurada', () => {
        process.env.AGENT_VERSION = '2.5.0';
        expect(getAgentVersion()).toBe('2.5.0');
    });

    it('deve fazer trim em AGENT_VERSION', () => {
        process.env.AGENT_VERSION = '  3.0.1  ';
        expect(getAgentVersion()).toBe('3.0.1');
    });

    it('deve usar npm_package_version se fs falhar', () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        process.env.npm_package_version = '1.4.0-beta';

        expect(getAgentVersion()).toBe('1.4.0-beta');
    });

    it('deve utilizar fallback padrão se fs falhar e não houver variáveis de ambiente', () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);

        expect(getAgentVersion()).toBe(DEFAULT_AGENT_VERSION);
    });

    it('deve cachear o valor lido do arquivo para evitar I/O repetido', () => {
        const spyRead = vi.spyOn(fs, 'readFileSync');
        const v1 = getAgentVersion();
        const v2 = getAgentVersion();

        expect(v1).toBe(v2);
        expect(v1).toMatch(/^\d+\.\d+\.\d+/);
        // readFileSync deve ter sido chamado no máximo 1 vez durante as chamadas consecutivas
        expect(spyRead).toHaveBeenCalledTimes(1);
    });

    it('deve recarregar após resetAgentVersionCache ser chamado', () => {
        const spyRead = vi.spyOn(fs, 'readFileSync');
        getAgentVersion();
        expect(spyRead).toHaveBeenCalledTimes(1);

        resetAgentVersionCache();
        getAgentVersion();
        expect(spyRead).toHaveBeenCalledTimes(2);
    });
});
