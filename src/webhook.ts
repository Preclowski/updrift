/**
 * Webhook notifications. POSTs a small JSON payload to settings.webhook_url.
 * No webhook configured → no-op. Delivery failures are swallowed (logged only)
 * so a dead endpoint can never break a user-facing request.
 */
export type WebhookEvent =
  | "feature.submitted" // new submission waiting for moderation
  | "feature.approved"
  | "feature.done";

export async function sendWebhook(
  webhookUrl: string,
  event: WebhookEvent,
  feature: { id: number; title: string; vote_count: number },
): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        feature: { id: feature.id, title: feature.title, votes: feature.vote_count },
        at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn("webhook delivery failed", err);
  }
}
