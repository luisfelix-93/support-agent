export interface IEncryptionService {
    encrypt(text: string, context?: string): string;
    decrypt(cipherText: string, context?: string): string;
}
