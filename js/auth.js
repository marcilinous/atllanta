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

  // Single canonical identity row: users(id, org_id, role, ...). One org per user.
  const { data: profile } = await sb
    .from('users')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  // Membership-shaped for existing consumers (getMembership().organization_id/.role/.full_name).
  currentMembership = profile
    ? {
        user_id: profile.id,
        organization_id: profile.org_id,
        role: profile.role,
        full_name: profile.full_name,
        email: profile.email,
      }
    : null;

  if (profile?.org_id) {
    const { data: org } = await sb
      .from('organizations')
      .select('*')
      .eq('id', profile.org_id)
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
  // A password-recovery link may land on an app page instead of /login.
  // Send it to /login, where the set-new-password form lives.
  if (event === 'PASSWORD_RECOVERY') {
    window.location.href = '/login' + window.location.hash;
  }
});
