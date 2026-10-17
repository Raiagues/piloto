import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { identityInUse, validLogin } from './login-identity.mjs';
import { uniqueNickname } from './team-identity.mjs';

const fail = code => Object.assign(new Error('A configuração administrativa não foi aplicada.'), { code });
const realOwner = user => user.accessRole === 'owner_admin' && !user.isDemoAccount && !user.demoSandboxId;
const usable = user => user && user.active === true && !user.deletedAt && !user.isDemoAccount && !user.demoSandboxId;

function plan(data, config) {
  const applied = (data.adminAccountOperations || []).find(item => item.operationId === config.operationId);
  if (applied) return { applied };
  const owners = data.users.filter(realOwner);
  if (config.createOnly && (owners.length || data.users.some(user => user.id === config.targetUserId))) {
    throw fail('ADMIN_ACCOUNT_ALREADY_EXISTS');
  }
  if (owners.length > 1) throw fail('ADMIN_ACCOUNT_AMBIGUOUS');
  if (owners.some(user => !usable(user))) throw fail('ADMIN_ACCOUNT_INACTIVE');
  let user;
  if (config.targetUserId) {
    user = data.users.find(item => item.id === config.targetUserId);
    if (!usable(user)) throw fail('ADMIN_ACCOUNT_TARGET_UNAVAILABLE');
    if (owners.some(owner => owner.id !== user.id)) throw fail('ADMIN_ACCOUNT_AMBIGUOUS');
  } else {
    user = owners[0];
    if (!user && data.authBootstrap?.completedAt) throw fail('ADMIN_ACCOUNT_BOOTSTRAP_CLOSED');
  }
  if (identityInUse(data.users, config.login, user?.id)) throw fail('ADMIN_ACCOUNT_LOGIN_CONFLICT');
  if (!user && !config.hasPassword) throw fail('ADMIN_ACCOUNT_PASSWORD_REQUIRED');
  if (user && (!user.passwordHash || !data.members.some(member => member.id === user.memberId && member.accountId === user.id))) {
    throw fail('ADMIN_ACCOUNT_TARGET_UNAVAILABLE');
  }
  return { user };
}

/**
 * Apply one explicitly identified private administration operation. Call after
 * store.init(). Nothing reads request data or environment variables here: the
 * server composition root supplies private configuration. Retaining an applied
 * operation across restarts never resets credentials again, even if the account
 * has subsequently changed or been removed.
 */
export async function configureAdminAccount(store, options = {}) {
  const { login: suppliedLogin, password, operationId, targetUserId, createOnly = false } = options || {};
  if ([suppliedLogin, password, operationId, targetUserId].every(value => value === undefined || value === null || value === '')) {
    return { status: 'not-configured' };
  }
  const login = typeof suppliedLogin === 'string' ? suppliedLogin.trim() : '';
  const hasPassword = password !== undefined && password !== null;
  const normalizedPassword = typeof password === 'string' ? password.normalize('NFKC') : '';
  if (!validLogin(login)) throw fail('ADMIN_ACCOUNT_INVALID_LOGIN');
  if (typeof operationId !== 'string' || !/^[a-zA-Z0-9._:-]{3,128}$/.test(operationId)) throw fail('ADMIN_ACCOUNT_INVALID_OPERATION');
  if (targetUserId !== undefined && targetUserId !== null && (typeof targetUserId !== 'string' || !targetUserId.trim() || targetUserId.length > 128)) {
    throw fail('ADMIN_ACCOUNT_INVALID_TARGET');
  }
  if (typeof createOnly !== 'boolean') throw fail('ADMIN_ACCOUNT_INVALID_OPERATION');
  if (hasPassword && (typeof password !== 'string' || password.length > 128 || normalizedPassword.length < 8 || normalizedPassword.length > 128 || !normalizedPassword.trim())) {
    throw fail('ADMIN_ACCOUNT_INVALID_PASSWORD');
  }
  const config = { login, operationId, targetUserId: targetUserId?.trim(), hasPassword, createOnly };
  try {
    const initial = plan(store.read(), config);
    if (initial.applied) return { status: 'already-applied', userId: initial.applied.userId };
    const passwordHash = hasPassword ? await argon2.hash(normalizedPassword, {
      type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1
    }) : null;

    return await store.update(data => {
      // Recheck every condition under the store transaction. A concurrent signup,
      // rename, deletion or setup must not silently select a different account.
      const current = plan(data, config);
      if (current.applied) return { status: 'already-applied', userId: current.applied.userId };
      if ((initial.user?.id || null) !== (current.user?.id || null)) throw fail('ADMIN_ACCOUNT_STATE_CHANGED');
      if (initial.user && ['passwordHash', 'login', 'accessRole', 'memberId'].some(key => initial.user[key] !== current.user[key])) {
        throw fail('ADMIN_ACCOUNT_STATE_CHANGED');
      }
      const timestamp = new Date().toISOString();
      let user = current.user;
      const created = !user;
      if (!user) {
        const memberId = randomUUID();
        user = {
          id: randomUUID(), memberId, name: 'Administração', login,
          nickname: uniqueNickname([...data.users, { login }], 'Administrador'),
          email: '', emailVerifiedAt: null, passwordHash, accessRole: 'owner_admin',
          institution: '', course: '', academicStage: '', availabilityHours: 0,
          avatarUrl: '', primaryArea: 'systems', active: true,
          createdAt: timestamp, updatedAt: timestamp
        };
        data.users.push(user);
        data.members.push({
          id: memberId, accountId: user.id, displayName: user.name, email: '',
          missionRole: 'captain', primaryArea: 'systems', secondaryAreas: [],
          institution: '', course: '', academicStage: '', skills: [], availabilityHours: 0,
          notes: '', avatarUrl: '', accountStatus: 'active', createdAt: timestamp, updatedAt: timestamp
        });
      } else {
        Object.assign(user, { login, accessRole: 'owner_admin', updatedAt: timestamp });
        if (hasPassword) user.passwordHash = passwordHash;
      }
      if (hasPassword) data.sessions = data.sessions.filter(session => session.userId !== user.id);
      data.authBootstrap = { ...data.authBootstrap, completedAt: data.authBootstrap?.completedAt || timestamp };
      // The operation journal doubles as the private audit trail. It contains
      // identifiers and action metadata only, never login or password values.
      (data.adminAccountOperations ||= []).push({
        operationId, userId: user.id, appliedAt: timestamp,
        action: created ? 'admin.created' : initial.user.accessRole === 'owner_admin' ? 'admin.updated' : 'admin.promoted',
        passwordUpdated: hasPassword
      });
      return { status: 'applied', userId: user.id, created, passwordUpdated: hasPassword };
    });
  } catch (error) {
    if (error?.code?.startsWith('ADMIN_ACCOUNT_')) throw error;
    // Hash/store errors can contain implementation details: do not attach their
    // message or cause to startup logs or the public API.
    throw fail('ADMIN_ACCOUNT_CONFIG_FAILED');
  }
}
