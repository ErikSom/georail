// script/upload-db.js
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// --- .env loading part (this is correct) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Error: Could not load SUPABASE_URL or SUPABASE_SERVICE_KEY.");
    console.error(`Attempted to load .env from: ${envPath}`);
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
// --- End of .env loading part ---


// We no longer need the single insertRow() function

async function main() {
    console.log('Using batch insert function insert_rail_lines_batch()...');

    // Assumes rail-data.json is in your project root (one level up from /script)
    const dataPath = path.resolve(__dirname, './rail-data.json');

    let geojsonData;
    try {
        geojsonData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    } catch (e) {
        console.error(`Failed to read rail-data.json from ${dataPath}`);
        console.error('Make sure "rail-data.json" is in your project root.');
        return;
    }

    const features = geojsonData.features;

    if (!features || features.length === 0) {
        console.error('No features found in rail-data.json.');
        return;
    }

    console.log(`Found ${features.length} features. Starting batch upload...`);

    // 500 is now a good, efficient batch size
    const BATCH_SIZE = 500;
    for (let i = 0; i < features.length; i += BATCH_SIZE) {
        const batch = features.slice(i, i + BATCH_SIZE);

        console.log(`Uploading batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(features.length / BATCH_SIZE)} (features ${i} to ${i + batch.length - 1})...`);

        // This is the new part:
        // Call the batch function ONCE with the entire array of features
        const { error } = await supabase.rpc('insert_rail_lines_batch', {
            features: batch
        });

        if (error) {
            // If this fails, it's likely a data issue in the batch
            console.error(`Error in batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        }
    }

    console.log('All data loaded successfully!');
}

main();