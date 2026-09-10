# Project lifecycle and observable execution

The chief manages work through conversation. The task board and each Bot's work panel are read-only views of the same durable execution records.

## Identity and acceptance

Project identity is shared across its group and the chief's direct conversation. Delivery identity v2 comprises the planned work scope and rework generation; historical job associations are excluded. A normal delivery cannot be replaced by another normal dispatch: changed work must enter a recorded rework round. Dependency acceptance is checked recursively.

Legacy migration carries forward only approvals that were valid immediately before migration, maps their dependency fingerprints, and preserves previous decisions in the audit history. Invalid approvals and unmapped review requests remain invalid. The upgrade is idempotent and occurs before dispatch begins.

Review responsibility is separately recorded with user authorization. Delegation is not acceptance and does not modify delivery identity. Engineering stages may be reviewed by the chief; final delivery remains a user decision. Final quality acceptance is explicitly marked and must include every required branch.

## Execution and recovery

Dispatch means queued, not running. A durable cancelled or failed status takes precedence over stale scheduling entries. Historical replies and absent reports are never evidence of active execution.

When a prerequisite is accepted, the system may resume the latest dependency-cancelled attempt only if it never started and still matches the current scope and generation. A new job retains retryOf; the old cancellation remains immutable. User-cancelled, failed, outdated or already-replaced attempts cannot be silently replayed. The chief has an explicit retry tool with the same validation.

Repair requires a separate retest attempt and recorded conclusion before acceptance. The final quality stage cannot start until its required branches are accepted. Progress queries are rendered from current structured state rather than an inferred narrative.

## Messages and visibility

Direct and group user messages are saved before execution, with stable per-request, per-role message identities. Concurrent retry writes are serialized and deduplicated by identity; identical text with different request IDs remains independent. The client retains unacknowledged messages and reconciles them with server history. Review notices contain the specific stage and its artifacts instead of repeating the whole project report for every stage.

Each Bot conversation exposes current work, project, elapsed time, last activity, dispatch and reply, checkpoints and recent actual tool events. Checkpoints are explicitly self-reported, not accepted results. Detailed logs are loaded on expansion, bounded and scrubbed of common credential fields; reasoning events are not presented. Older jobs without recorded tool events are labelled honestly rather than reconstructed.

## Verification

Regression coverage includes real HTTP direct/group message persistence, concurrent retry, delayed history, component switching, v2 migration and invalid-approval boundaries, dependency recovery, scope rejection, final-stage coverage, and rendered Bot work panels. Runtime installation is preceded by an idle-state check and a local rollback backup. Existing project decisions and cancelled attempts are preserved.
