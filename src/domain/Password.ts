import { createHash } from 'crypto';

export class Password {
    private readonly value: string;

    private constructor(value: string) {
        this.value = value;
    }

    /**
     * Creates a new Password instance by hashing the plain text.
     * Encrypts/hashes the password as soon as it enters the system.
     */
    public static create(plainText: string): Password {
        if (!plainText || plainText.trim().length < 6) {
            throw new Error('Password must be at least 6 characters long.');
        }
        const hashedPassword = createHash('sha256').update(plainText).digest('hex');
        return new Password(hashedPassword);
    }

    /**
     * Restores a Password instance from an already hashed string.
     * Use this when loading the password from the database.
     */
    public static restore(hashedValue: string): Password {
        return new Password(hashedValue);
    }

    /**
     * Compares a plain text password with this hashed password.
     */
    public compare(plainText: string): boolean {
        const hashed = createHash('sha256').update(plainText).digest('hex');
        return this.value === hashed;
    }

    /**
     * Returns the hashed value of the password.
     */
    public getValue(): string {
        return this.value;
    }
}
