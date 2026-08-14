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
        const tamperedTag = authTag.substring(0, authTag.length - 2) + '00';
        const tamperedCipher = `${iv}:${tamperedTag}:${data}`;

        expect(() => service.decrypt(tamperedCipher)).toThrow();
    });

    it('deve retornar string vazia ao criptografar ou descriptografar texto vazio', () => {
        const service = new AESEncryptionService(testKey);
        expect(service.encrypt('')).toBe('');
        expect(service.decrypt('')).toBe('');
    });
});
