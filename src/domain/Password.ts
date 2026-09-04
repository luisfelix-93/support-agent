import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SALT_LENGTH = 16;
const SCRYPT_PREFIX = 'scrypt:';

export class Password {
    private readonly value: string;

    private constructor(value: string) {
        this.value = value;
    }

    /**
     * Creates a new Password instance by hashing the plain text with scrypt.
     */
    public static create(plainText: string): Password {
        if (!plainText || plainText.trim().length < 6) {
            throw new Error('Password must be at least 6 characters long.');
        }
        const salt = randomBytes(SALT_LENGTH);
        const hash = scryptSync(plainText, salt, SCRYPT_KEYLEN, {
            cost: SCRYPT_COST,
            blockSize: SCRYPT_BLOCK_SIZE,
            parallelization: SCRYPT_PARALLELISM,
        });
        return new Password(`${SCRYPT_PREFIX}${salt.toString('hex')}:${hash.toString('hex')}`);
    }

    /**
     * Restores a Password instance from an already hashed string (scrypt or legacy SHA-256).
     */
    public static restore(hashedValue: string): Password {
        return new Password(hashedValue);
    }

    /**
     * Compares a plain text password with this hashed password.
     * Supports both scrypt (current) and legacy SHA-256 formats.
     */
    public compare(plainText: string): boolean {
        if (this.isScryptFormat()) {
            return this.compareScrypt(plainText);
        }
        return this.compareLegacySha256(plainText);
    }

    /**
     * Returns true if the stored hash uses the legacy SHA-256 format
     * and should be re-hashed on next login.
     */
    public needsRehash(): boolean {
        return !this.isScryptFormat();
    }

    /**
     * Returns the hashed value of the password.
     */
    public getValue(): string {
        return this.value;
    }

    private isScryptFormat(): boolean {
        return this.value.startsWith(SCRYPT_PREFIX);
    }

    private compareScrypt(plainText: string): boolean {
        const parts = this.value.slice(SCRYPT_PREFIX.length).split(':');
        if (parts.length !== 2) return false;

        const salt = Buffer.from(parts[0], 'hex');
        const storedHash = Buffer.from(parts[1], 'hex');
        const candidateHash = scryptSync(plainText, salt, SCRYPT_KEYLEN, {
            cost: SCRYPT_COST,
            blockSize: SCRYPT_BLOCK_SIZE,
            parallelization: SCRYPT_PARALLELISM,
        });
        return timingSafeEqual(storedHash, candidateHash);
    }

    private compareLegacySha256(plainText: string): boolean {
        const hashed = createHash('sha256').update(plainText).digest('hex');
        return this.value === hashed;
    }
}
