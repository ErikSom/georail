import { createClient } from "@supabase/supabase-js";

let supabase = null;

function initializeSupabase() {
	supabase = createClient(
		process.env.SUPABASE_URL,
		process.env.SUPABASE_SERVICE_KEY
	);
}

export { supabase, initializeSupabase };
