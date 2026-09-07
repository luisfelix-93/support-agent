import crypto from 'crypto';
import type { IEncryptionService } from '../../domain/ports/IEncryptionService.js';

export class AESEncryptionService implements IEncryptionService {
    private readonly algorithm = 'aes-256-gcm';
    private readonly masterKey: Buffer;

    constructor(encryptionKey?: string) {
        const keyString = encryptionKey ?? process.env.ENCRYPTION_KEY;
        if (!keyString) {
            throw new Error('[AESEncryptionService] ENCRYPTION_KEY não foi configurada.');
        }

        // Suporta chave fornecida em Hex (64 caracteres = 32 bytes) ou Utf8 (32 caracteres)
        if (keyString.length === 64 && /^[0-9a-fA-F]{64}$/.test(keyString)) {
            this.masterKey = Buffer.from(keyString, 'hex');
        } else {
            this.masterKey = crypto.createHash('sha256').update(keyString).digest();
        }
    }

    /**
     * Deriva uma sub-chave de 256 bits a partir da masterKey usando HKDF (RFC 5869)
     * vinculada a um contexto de aplicação específico (ex: 'mcp', 'slack', etc.).
     */
    deriveKey(context: string): Buffer {
        return Buffer.from(
            crypto.hkdfSync('sha256', this.masterKey, Buffer.alloc(0), Buffer.from(context, 'utf8'), 32)
        );
    }

    private getKey(context?: string): Buffer {
        if (!context) {
            return this.masterKey;
        }
        return this.deriveKey(context);
    }

    /**
     * Retorna uma instância do serviço de criptografia pré-vinculada a um contexto HKDF.
     */
    withContext(context: string): IEncryptionService {
        return {
            encrypt: (text: string) => this.encrypt(text, context),
            decrypt: (cipherText: string) => this.decrypt(cipherText, context),
        };
    }

    encrypt(text: string, context?: string): string {
        if (!text) {
            return '';
        }

        const key = this.getKey(context);
        const iv = crypto.randomBytes(12); // 96 bits recomendado para GCM
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);

        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag().toString('hex');
        const ivHex = iv.toString('hex');

        return `${ivHex}:${authTag}:${encrypted}`;
    }

    decrypt(cipherText: string, context?: string): string {
        if (!cipherText) {
            return '';
        }

        const parts = cipherText.split(':');
        if (parts.length !== 3) {
            throw new Error('[AESEncryptionService] Formato de texto cifrado inválido.');
        }

        const [ivHex, authTagHex, encryptedHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const key = this.getKey(context);
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}
