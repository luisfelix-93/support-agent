import crypto from 'crypto';
import type { IEncryptionService } from '../../domain/ports/IEncryptionService.js';

export class AESEncryptionService implements IEncryptionService {
    private readonly algorithm = 'aes-256-gcm';
    private readonly key: Buffer;

    constructor(encryptionKey?: string) {
        const keyString = encryptionKey ?? process.env.ENCRYPTION_KEY;
        if (!keyString) {
            throw new Error('[AESEncryptionService] ENCRYPTION_KEY não foi configurada.');
        }

        // Suporta chave fornecida em Hex (64 caracteres = 32 bytes) ou Utf8 (32 caracteres)
        if (keyString.length === 64 && /^[0-9a-fA-F]{64}$/.test(keyString)) {
            this.key = Buffer.from(keyString, 'hex');
        } else {
            this.key = crypto.createHash('sha256').update(keyString).digest();
        }
    }

    encrypt(text: string): string {
        if (!text) {
            return '';
        }

        const iv = crypto.randomBytes(12); // 96 bits recomendado para GCM
        const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag().toString('hex');
        const ivHex = iv.toString('hex');

        return `${ivHex}:${authTag}:${encrypted}`;
    }

    decrypt(cipherText: string): string {
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

        const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}
