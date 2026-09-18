import { describe, it, expect } from 'vitest';
import { AESEncryptionService } from './AESEncryptionService.js';

describe('AESEncryptionService', () => {
    const testKey = '12345678901234567890123456789012'; // 32 caracteres

    it('deve criptografar e descriptografar um texto corretamente', () => {
        const service = new AESEncryptionService(testKey);
        const originalText = 'xoxb-123456789-secret-slack-token';

        const encrypted = service.encrypt(originalText);
        expect(encrypted).not.toBe(originalText);
        expect(encrypted.split(':')).toHaveLength(3);

        const decrypted = service.decrypt(encrypted);
        expect(decrypted).toBe(originalText);
    });

    it('deve gerar vetores de inicialização (IV) diferentes para o mesmo texto', () => {
        const service = new AESEncryptionService(testKey);
        const text = 'same-token';

        const enc1 = service.encrypt(text);
        const enc2 = service.encrypt(text);

        expect(enc1).not.toBe(enc2);
        expect(service.decrypt(enc1)).toBe(text);
        expect(service.decrypt(enc2)).toBe(text);
    });

    it('deve lançar erro se a chave de criptografia não for informada nem estiver no env', () => {
        const originalEnv = process.env.ENCRYPTION_KEY;
        delete process.env.ENCRYPTION_KEY;

        expect(() => new AESEncryptionService()).toThrow(
            '[AESEncryptionService] ENCRYPTION_KEY não foi configurada.'
        );

        process.env.ENCRYPTION_KEY = originalEnv;
    });

    it('deve lançar erro se o formato do texto cifrado for inválido', () => {
        const service = new AESEncryptionService(testKey);
        expect(() => service.decrypt('formato-invalido')).toThrow(
            '[AESEncryptionService] Formato de texto cifrado inválido.'
        );
    });

    it('deve lançar erro se o authTag ou dado cifrado for adulterado', () => {
        const service = new AESEncryptionService(testKey);
        const encrypted = service.encrypt('super-secret');
        const [iv, authTag, data] = encrypted.split(':');

        // Garantia matemática: XOR 0xff nunca produz o mesmo valor (evita falso-positivo quando o final for '00')
        const firstTagByte = parseInt(authTag.substring(0, 2), 16);
        const flippedTagByte = (firstTagByte ^ 0xff).toString(16).padStart(2, '0');
        const tamperedTag = flippedTagByte + authTag.substring(2);
        const tamperedTagCipher = `${iv}:${tamperedTag}:${data}`;

        expect(() => service.decrypt(tamperedTagCipher)).toThrow();

        // Adulteração do dado cifrado também deve lançar erro
        const firstDataByte = parseInt(data.substring(0, 2), 16);
        const flippedDataByte = (firstDataByte ^ 0xff).toString(16).padStart(2, '0');
        const tamperedDataCipher = `${iv}:${authTag}:${flippedDataByte}${data.substring(2)}`;

        expect(() => service.decrypt(tamperedDataCipher)).toThrow();
    });


    it('deve retornar string vazia ao criptografar ou descriptografar texto vazio', () => {
        const service = new AESEncryptionService(testKey);
        expect(service.encrypt('')).toBe('');
        expect(service.decrypt('')).toBe('');
    });

    describe('HKDF Key Derivation & Context Isolation', () => {
        it('deve derivar chaves de 32 bytes diferentes para contextos distintos', () => {
            const service = new AESEncryptionService(testKey);
            const mcpKey = service.deriveKey('mcp');
            const slackKey = service.deriveKey('slack');

            expect(mcpKey).toHaveLength(32);
            expect(slackKey).toHaveLength(32);
            expect(mcpKey).not.toEqual(slackKey);
        });

        it('deve criptografar e descriptografar corretamente usando contexto HKDF', () => {
            const service = new AESEncryptionService(testKey);
            const secret = 'mcp-api-key-secret-value';

            const encrypted = service.encrypt(secret, 'mcp');
            const decrypted = service.decrypt(encrypted, 'mcp');

            expect(decrypted).toBe(secret);
        });

        it('deve falhar ao descriptografar com contexto divergente', () => {
            const service = new AESEncryptionService(testKey);
            const secret = 'mcp-api-key-secret-value';

            const encrypted = service.encrypt(secret, 'mcp');

            // Tentativa com outro contexto deve falhar (GCM auth tag mismatch)
            expect(() => service.decrypt(encrypted, 'slack')).toThrow();
            // Tentativa sem contexto (chave base) também deve falhar
            expect(() => service.decrypt(encrypted)).toThrow();
        });

        it('deve permitir criar serviço pré-vinculado a um contexto via withContext', () => {
            const service = new AESEncryptionService(testKey);
            const mcpService = service.withContext('mcp');

            const secret = 'pre-bound-context-secret';
            const encrypted = mcpService.encrypt(secret);
            const decrypted = mcpService.decrypt(encrypted);

            expect(decrypted).toBe(secret);

            // Descriptografar diretamente no serviço base sem contexto deve falhar
            expect(() => service.decrypt(encrypted)).toThrow();
        });
    });
});
