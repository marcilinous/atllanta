import sb from './supabase.js';

export async function fetchAll(table, options = {}) {
  let query = sb.from(table).select(options.select || '*');
  if (options.filters) {
    for (const [key, val] of Object.entries(options.filters)) {
      query = query.eq(key, val);
    }
  }
  if (options.order) {
    query = query.order(options.order, { ascending: options.ascending ?? false });
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchOne(table, id) {
  const { data, error } = await sb.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function insertRow(table, row) {
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateRow(table, id, updates) {
  const { data, error } = await sb.from(table).update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRow(table, id) {
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw error;
}

export async function rpc(fn, params) {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw error;
  return data;
}
