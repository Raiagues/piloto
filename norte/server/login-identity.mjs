// Logins are private account identifiers; nicknames remain public team handles.
// Reserve both namespaces so legacy nickname sign-in can never select another user.
export function normalizeLogin(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validLogin(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{3,30}$/.test(value);
}

export function identityInUse(users, identifier, excludingId = null) {
  const key = normalizeLogin(identifier);
  return Boolean(key && users.some(user => user.id !== excludingId
    && [user.login, user.nickname].some(value => normalizeLogin(value) === key)));
}

export function findLoginUser(users, identifier) {
  const key = normalizeLogin(identifier);
  if (!key) return null;
  const matches = users.filter(user => user.active && (key.includes('@')
    ? normalizeLogin(user.email) === key
    : [user.login, user.nickname].some(value => normalizeLogin(value) === key)));
  // Fail closed for malformed imported legacy records with colliding identities.
  return matches.length === 1 ? matches[0] : null;
}
