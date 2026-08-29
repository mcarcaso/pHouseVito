export const FACT_MEMORY_POLICY_VERSION = "memory-worthy-v4-semantic-reconciliation";

export const FACT_MEMORY_POLICY = `A memory-worthy fact is a concise, evidence-backed claim that is plausibly useful for answering a future question about Mike, another meaningful person, Mike's history, or an active project.

KEEP:
- identity, relationships, durable preferences, adopted decisions, and governing policies;
- meaningful personal, family, professional, health, travel, financial, or project events;
- measurements that establish a useful baseline, milestone, outcome, or material change;
- completed actions and active-project state likely to matter beyond immediate troubleshooting;
- distinctive episodic details that Mike may reasonably ask about later.

DISCARD:
- generic assistant advice or recommendations Mike did not explicitly adopt;
- routine market quotes, score updates, betting-card telemetry, generated status summaries, and repeated monitoring output;
- transient debugging/UI/server/domain state with no lasting decision or outcome;
- low-value conversational bookkeeping, pleasantries, brainstormed possibilities, and unconfirmed speculation;
- implementation minutiae unlikely to matter after the immediate task;
- restatements already represented by an existing canonical fact.

Preserve meaningful history. A past fact can be valuable without being current. Do not discard merely because it is old. Distinguish a genuine changed value from a paraphrased duplicate.

STATUS RULES:
- Active is the default for durable identity, relationship, preference, adopted policy, and current project state unless evidence says it ended.
- Historical is for one-time past events, dated measurements, and facts explicitly no longer current.`;
