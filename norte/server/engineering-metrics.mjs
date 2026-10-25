// Operational totals contain no prompts, documents or meeting text.
export function createEngineeringMetrics(store) {
  return { async recordProviderAttempt(attempt) {
    await store.update(data => {
      const totals = data.engineeringMetrics ||= { llmCalls: 0, providerFailures: 0, reportedInputTokens: 0, reportedOutputTokens: 0 };
      totals.llmCalls++;
      if (attempt.status !== 'provider_completed') totals.providerFailures++;
      totals.reportedInputTokens += Number(attempt.usageMetadata?.promptTokenCount) || 0;
      totals.reportedOutputTokens += Number(attempt.outputTokens) || 0;
      totals.updatedAt = new Date().toISOString();
    });
  } };
}
