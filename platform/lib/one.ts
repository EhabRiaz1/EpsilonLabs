/** A Supabase embedded relation comes back as an object or a one-element array depending on the join; this reads it
 *  as one row (or null). */
export const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
