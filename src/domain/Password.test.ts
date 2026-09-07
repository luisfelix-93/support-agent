import { describe, it, expect } from 'vitest';
import { Password } from './Password.js';
import { createHash } from 'crypto';

describe('Password', () => {
    describe('create()', () => {
        it('deve criar uma instância com hash scrypt', () => {
            const password = Password.create('minha-senha-segura');
            expect(password.getValue()).toMatch(/^scrypt:[a-f0-9]+:[a-f0-9]+$/);
        });

        it('não deve armazenar a senha em texto plano', () => {
            const plainText = 'senha123';
            const password = Password.create(plainText);
            expect(password.getValue()).not.toBe(plainText);
        });

        it('deve lançar erro para senha com menos de 6 caracteres', () => {
            expect(() => Password.create('abc')).toThrow(
                'Password must be at least 6 characters long.'
            );
        });

        it('deve lançar erro para senha com apenas espaços', () => {
            expect(() => Password.create('      ')).toThrow(
                'Password must be at least 6 characters long.'
            );
        });

        it('deve lançar erro para senha vazia', () => {
            expect(() => Password.create('')).toThrow();
        });

        it('deve gerar hashes diferentes para a mesma senha (salt aleatório)', () => {
            const p1 = Password.create('senha-igual');
            const p2 = Password.create('senha-igual');
            expect(p1.getValue()).not.toBe(p2.getValue());
        });
    });

    describe('restore()', () => {
        it('deve restaurar uma instância a partir de hash scrypt', () => {
            const password = Password.create('minha-senha');
            const restored = Password.restore(password.getValue());
            expect(restored.getValue()).toBe(password.getValue());
        });

        it('deve restaurar uma instância a partir de hash SHA-256 legado', () => {
            const legacyHash = createHash('sha256').update('senha-legado').digest('hex');
            const restored = Password.restore(legacyHash);
            expect(restored.getValue()).toBe(legacyHash);
        });
    });

    describe('compare()', () => {
        it('deve retornar true para a senha correta (scrypt)', () => {
            const password = Password.create('senha-correta');
            expect(password.compare('senha-correta')).toBe(true);
        });

        it('deve retornar false para senha incorreta (scrypt)', () => {
            const password = Password.create('senha-correta');
            expect(password.compare('senha-errada')).toBe(false);
        });

        it('deve ser case-sensitive (scrypt)', () => {
            const password = Password.create('SenhaCorreta');
            expect(password.compare('senhacorreta')).toBe(false);
        });

        it('deve retornar true para senha correta em hash SHA-256 legado', () => {
            const legacyHash = createHash('sha256').update('senha-legado').digest('hex');
            const restored = Password.restore(legacyHash);
            expect(restored.compare('senha-legado')).toBe(true);
        });

        it('deve retornar false para senha incorreta em hash SHA-256 legado', () => {
            const legacyHash = createHash('sha256').update('senha-legado').digest('hex');
            const restored = Password.restore(legacyHash);
            expect(restored.compare('senha-errada')).toBe(false);
        });
    });

    describe('needsRehash()', () => {
        it('deve retornar false para hash scrypt', () => {
            const password = Password.create('minha-senha');
            expect(password.needsRehash()).toBe(false);
        });

        it('deve retornar true para hash SHA-256 legado', () => {
            const legacyHash = createHash('sha256').update('senha-legado').digest('hex');
            const restored = Password.restore(legacyHash);
            expect(restored.needsRehash()).toBe(true);
        });
    });
});
