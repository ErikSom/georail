import { createClient } from "@supabase/supabase-js";

let supabase = null;
let supabaseUrl = null;
let supabaseAnonKey = null;

function initializeSupabase() {
	supabaseUrl = process.env.SUPABASE_URL;
	supabaseAnonKey = process.env.SUPABASE_ANON_KEY || null;

	supabase = createClient(
		supabaseUrl,
		process.env.SUPABASE_SERVICE_KEY
	);
}

// Create a per-request client that carries the user's JWT so auth.uid()
// and role-based checks work inside SECURITY INVOKER/DEFINER functions.
function getSupabaseForToken(token) {
	if (!supabaseUrl || !supabaseAnonKey || !token) {
		return supabase;
	}

	return createClient(supabaseUrl, supabaseAnonKey, {
		global: {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		},
	});
}

export { supabase, initializeSupabase, getSupabaseForToken };
