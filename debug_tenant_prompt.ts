
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    console.log('Checking Tenant System Prompt...');
    const { data: tenants, error } = await supabase.from('tenants').select('tenant_id, system_prompt').limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (tenants.length > 0) {
        console.log(`Tenant ID: ${tenants[0].tenant_id}`);
        console.log('--- SYSTEM PROMPT START ---');
        console.log(tenants[0].system_prompt);
        console.log('--- SYSTEM PROMPT END ---');
    } else {
        console.log('No tenants found.');
    }
}

check();
