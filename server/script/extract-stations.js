// script/extract-stations.js
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// --- .env loading part (same as before) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Error: Could not load SUPABASE_URL or SUPABASE_SERVICE_KEY.");
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
// --- End of .env loading part ---


async function main() {
    console.log('Reading full rail-data.json file...');
    const dataPath = path.resolve(__dirname, './rail-data.json');
    const geojsonData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const allFeatures = geojsonData.features;

    console.log(`Found ${allFeatures.length} total features. Filtering for stations...`);

    // This is the core logic from your old script, translated to a filter
    const stationFeatures = allFeatures.filter(f =>
        f.properties?.['@id']?.startsWith('node') &&
        f.properties?.public_transport === 'stop_position' &&
        f.geometry?.type === 'Point' &&
        f.properties.name // We only want stations that have a name
    );

    console.log(`Found ${stationFeatures.length} station/stop features to upload.`);

    if (stationFeatures.length === 0) {
        console.log('No stations found. Exiting.');
        return;
    }

    // Before uploading, clear the table to prevent duplicates if you run this again
    console.log('Clearing the stations table...');
    const { error: truncateError } = await supabase.rpc('sql', { sql: 'TRUNCATE TABLE stations;' });
    if (truncateError) {
        // This is a workaround for a bug where the 'sql' rpc isn't found.
        // If it fails, we'll try a direct query.
        console.warn("Could not use RPC to truncate, trying direct query...");
        const { error: directTruncateError } = await supabase.from('stations').delete().gt('id', -1);
        if (directTruncateError) {
            console.error('FATAL: Could not clear the stations table.', directTruncateError);
            return;
        }
    }


    // Map the filtered features into the format our batch function expects
    const stationsToUpload = stationFeatures.map(f => ({
        name: f.properties.name,
        ref: f.properties.ref || null, // The platform/track, or null if not present
        properties: f.properties,      // The full original properties object
        geom_geojson: f.geometry       // The GeoJSON geometry object for conversion
    }));

    const BATCH_SIZE = 500;
    console.log('Starting upload in batches...');

    for (let i = 0; i < stationsToUpload.length; i += BATCH_SIZE) {
        const batch = stationsToUpload.slice(i, i + BATCH_SIZE);

        console.log(`Uploading batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(stationsToUpload.length / BATCH_SIZE)}...`);

        const { error } = await supabase.rpc('insert_stations_batch', {
            stations_data: batch
        });

        if (error) {
            console.error(`Error in batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        }
    }

    console.log('✅ Station extraction and upload complete!');
}

main();