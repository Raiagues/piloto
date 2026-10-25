// Keep historical isolated records private; the demo account feature is retired.
export const sameDemoScope = (user, record) => (user?.demoSandboxId || null) === (record?.demoSandboxId || null);
