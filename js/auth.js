import sb from './supabase.js';

let currentUser = null;
let currentOrg = null;
let currentMembership = null;

export async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = '/login';
    return null;
  }
  currentUser = session.user;
  return session;
}

export async function loadUserProfile() {
  if (!currentUser) return null;

  const { data: membership } = await sb
    .from('memberships')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at')
    .limit(1)
    .single();

  if (membership) {
    const roleMap = { super_admin: 'owner', agency_admin: 'admin', client_admin: 'admin', client_member: 'member' };
    membership.role = roleMap[membership.role] || membership.role;
  }
  currentMembership = membership;

  if (membership) {
    const { data: org } = await sb
      .from('organizations')
      .select('*')
      .eq('id', membership.organization_id)
      .single();
    currentOrg = org;
  }

  return { user: currentUser, org: currentOrg, membership: currentMembership };
}

export function getUser() { return currentUser; }
export function getOrg() { return currentOrg; }
export function getMembership() { return currentMembership; }

export async function logout() {
  await sb.auth.signOut();
  window.location.href = '/login';
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    currentOrg = null;
    currentMembership = null;
    window.location.href = '/login';
  }
});
