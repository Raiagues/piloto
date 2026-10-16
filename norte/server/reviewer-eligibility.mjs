/** Organizational examples have no operator who can independently review.
 * The legacy match is deliberately narrow: the demo visitor uses the same
 * password placeholder, and must keep all of its ordinary permissions. */
export function isFictionalProfile(user) {
  return Boolean(user && (user.isFictionalProfile === true || (
    user.passwordHash === 'demo-account-without-password'
    && /-q-(?:ana|bruno|clara|davi|elisa|felipe|gabriela)-user$/u.test(user.id || '')
    && typeof user.email === 'string' && user.email.endsWith('@demo.norte.invalid')
  )));
}

export function canReviewAccount(user) {
  return Boolean(user && user.active !== false && !user.disabled && !isFictionalProfile(user));
}
