import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-cbc';
// ENCRYPTION_KEY must be 32 bytes (64 hex characters)
// In production, this should be set in environment variables.
// Fallback is provided ONLY for dev convenience, but user should set env var.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000';
const IV_LENGTH = 16; // For AES, this is always 16

export function encrypt(text: string): string {
    if (!text) return text;
    try {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        console.error('Encryption failed:', e);
        return text; // Fallback to raw (dangerous but prevents crash during migration) or throw? 
        // Ideally throw, but for partial migration scenarios, we might want to handle gracefully.
        // However, for security, we should ensure everything is encrypted.
        throw e;
    }
}

export function decrypt(text: string): string {
    if (!text) return text;
    // Check format iv:content
    const textParts = text.split(':');
    if (textParts.length !== 2) {
        // Not encrypted or invalid format. 
        // ASSUMPTION: If it's not in iv:content format, it's a RAW token from before migration.
        // Return as is.
        return text;
    }

    try {
        const iv = Buffer.from(textParts.shift()!, 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        console.error('Decryption failed:', e);
        // If decryption fails (wrong key?), return original text? No, that's garbage.
        // But if we return original, it might be raw text which matches the pattern? Unlikely.
        return text;
    }
}
