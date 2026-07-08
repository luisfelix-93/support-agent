import { describe, it, expect } from 'vitest';
import { Password } from './Password.js';

describe('Password', () => {
    describe('create()', () => {
        it('deve criar uma instância com hash SHA-256 da senha', () => {
            const password = Password.create('minha-senha-segura');
            // O valor interno deve ser um hex de 64 chars (SHA-256)
            expect(password.getValue()).toMatch(/^[a-f0-9]{64}$/);
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

        it('deve gerar hashes iguais para a mesma senha', () => {
            const p1 = Password.create('senha-igual');
            const p2 = Password.create('senha-igual');
            expect(p1.getValue()).toBe(p2.getValue());
        });
    });

    describe('restore()', () => {
        it('deve restaurar uma instância a partir do hash existente', () => {
            const password = Password.create('minha-senha');
            const restored = Password.restore(password.getValue());
            expect(restored.getValue()).toBe(password.getValue());
        });
    });

    describe('compare()', () => {
        it('deve retornar true para a senha correta', () => {
            const password = Password.create('senha-correta');
            expect(password.compare('senha-correta')).toBe(true);
        });

        it('deve retornar false para senha incorreta', () => {
            const password = Password.create('senha-correta');
            expect(password.compare('senha-errada')).toBe(false);
        });

        it('deve ser case-sensitive', () => {
            const password = Password.create('SenhaCorreta');
            expect(password.compare('senhacorreta')).toBe(false);
        });
    });
});
