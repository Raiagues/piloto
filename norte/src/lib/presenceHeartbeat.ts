/** Coalesce visibility/interval events without replaying a failed request. */
export function createHeartbeatSender(send: () => Promise<unknown>, now = () => performance.now()) {
  let pending: Promise<void> | null = null;
  let lastAttempt = -Infinity;
  return () => {
    if (pending) return pending;
    if (now() - lastAttempt < 25_000) return Promise.resolve();
    lastAttempt = now();
    pending = Promise.resolve().then(send).then(() => undefined).catch(error => {
      lastAttempt = -Infinity; // A later interaction/tick may try again.
      throw error;
    }).finally(() => { pending = null; });
    return pending;
  };
}
