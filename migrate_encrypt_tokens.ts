import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes } from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000';
const IV_LENGTH = 16;

function encrypt(text: string): string {
    if (!text) return text;
    try {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        console.error('Encryption failed:', e);
        return text;
    }
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function migrate() {
    console.log('Starting Token Encryption Migration...');

    // 1. Fetch all tenants
    const { data: tenants, error } = await supabase.from('tenants').select('*');
    if (error) {
        console.error('Fetch error:', error);
        return;
    }

    console.log(`Found ${tenants.length} tenants.`);

    for (const tenant of tenants) {
        console.log(`Processing Tenant: ${tenant.tenant_id}`);
        const updates: any = {};

        // Decrypt check: If it already contains ':', it might be already encrypted (or just a colon).
        // Since original tokens (LINE/OpenAI) are usually pure alphanumeric or start with specific prefixes,
        // and our encrypted format is HEX:HEX (iv:content), we can guess.
        // But safer is: assume ALL current are RAW if we are running this once.
        // Or check if it looks like encryption format.

        // Helper to check if string is likely already encrypted (IV:Content hex)
        const isEncrypted = (str: string) => {
            if (!str) return false;
            const parts = str.split(':');
            return parts.length === 2 && parts[0].length === 32; // IV 16 bytes = 32 hex chars
        };

        if (tenant.line_channel_access_token && !isEncrypted(tenant.line_channel_access_token)) {
            updates.line_channel_access_token = encrypt(tenant.line_channel_access_token);
        }
        if (tenant.openai_api_key && !isEncrypted(tenant.openai_api_key)) {
            updates.openai_api_key = encrypt(tenant.openai_api_key);
        }
        if (tenant.google_sheet_id && !isEncrypted(tenant.google_sheet_id)) {
            updates.google_sheet_id = encrypt(tenant.google_sheet_id);
        }
        if (tenant.line_channel_secret && !isEncrypted(tenant.line_channel_secret)) {
            updates.line_channel_secret = encrypt(tenant.line_channel_secret);
        }

        if (Object.keys(updates).length > 0) {
            const { error: updateError } = await supabase
                .from('tenants')
                .update(updates)
                .eq('tenant_id', tenant.tenant_id);

            if (updateError) console.error(`Failed to update ${tenant.tenant_id}:`, updateError);
            else console.log(`Encrypted fields for ${tenant.tenant_id}`);
        } else {
            console.log(`Skipped ${tenant.tenant_id} (No updates needed)`);
        }
    }
    console.log('Migration Complete.');
}

migrate();
