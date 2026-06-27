CREATE TABLE IF NOT EXISTS "team_governance_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"scope" text DEFAULT 'team' NOT NULL,
	"provider_id" text NOT NULL,
	"provider_version" text DEFAULT '1' NOT NULL,
	"config_json" text DEFAULT '{}' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"superseded_at" text
);
CREATE INDEX IF NOT EXISTS "idx_team_governance_policies_team_scope" ON "team_governance_policies" ("team_id","scope","active");

CREATE TABLE IF NOT EXISTS "project_governance_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_version" text DEFAULT '1' NOT NULL,
	"config_json" text DEFAULT '{}' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"superseded_at" text
);
CREATE INDEX IF NOT EXISTS "idx_project_governance_policies_project" ON "project_governance_policies" ("project_id","active");

CREATE TABLE IF NOT EXISTS "governance_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"scope" text DEFAULT 'project' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"proposal_type" text DEFAULT 'implementation' NOT NULL,
	"content_proposal_slug" text,
	"content_decision_slug" text,
	"active_version" integer DEFAULT 1 NOT NULL,
	"active_content_hash" text NOT NULL,
	"governance_provider_id" text NOT NULL,
	"governance_provider_version" text DEFAULT '1' NOT NULL,
	"governance_policy_id" text,
	"decision_id" text,
	"voting_starts_at" text,
	"voting_ends_at" text,
	"closed_at" text,
	"closed_reason" text,
	"created_by_type" text DEFAULT 'user' NOT NULL,
	"created_by_id" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_governance_proposals_team_status" ON "governance_proposals" ("team_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "idx_governance_proposals_project_status" ON "governance_proposals" ("project_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "idx_governance_proposals_scope_status" ON "governance_proposals" ("scope","status","updated_at");
CREATE INDEX IF NOT EXISTS "idx_governance_proposals_content_slug" ON "governance_proposals" ("content_proposal_slug");

CREATE TABLE IF NOT EXISTS "governance_proposal_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"change_reason" text,
	"created_by_type" text DEFAULT 'user' NOT NULL,
	"created_by_id" text,
	"created_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_governance_proposal_versions_unique" ON "governance_proposal_versions" ("proposal_id","version");
CREATE INDEX IF NOT EXISTS "idx_governance_proposal_versions_proposal" ON "governance_proposal_versions" ("proposal_id","created_at");

CREATE TABLE IF NOT EXISTS "governance_electorate_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"proposal_version" integer NOT NULL,
	"provider_id" text NOT NULL,
	"provider_version" text DEFAULT '1' NOT NULL,
	"rule_snapshot_json" text DEFAULT '{}' NOT NULL,
	"chambers_json" text DEFAULT '[]' NOT NULL,
	"eligible_voters_json" text DEFAULT '[]' NOT NULL,
	"delegations_json" text DEFAULT '[]' NOT NULL,
	"eligible_weight_total" real DEFAULT 0 NOT NULL,
	"active_weight_total" real DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_governance_electorate_snapshots_proposal" ON "governance_electorate_snapshots" ("proposal_id","proposal_version");

CREATE TABLE IF NOT EXISTS "governance_proposal_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"proposal_version" integer NOT NULL,
	"user_id" text NOT NULL,
	"vote" text NOT NULL,
	"reason" text,
	"chamber_votes_json" text DEFAULT '{}' NOT NULL,
	"effective_weights_json" text DEFAULT '{}' NOT NULL,
	"delegated_from_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_governance_proposal_votes_once" ON "governance_proposal_votes" ("proposal_id","proposal_version","user_id");
CREATE INDEX IF NOT EXISTS "idx_governance_proposal_votes_proposal" ON "governance_proposal_votes" ("proposal_id","proposal_version","vote");

CREATE TABLE IF NOT EXISTS "governance_vote_events" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"proposal_version" integer NOT NULL,
	"user_id" text NOT NULL,
	"prior_vote" text,
	"next_vote" text NOT NULL,
	"reason" text,
	"effective_weights_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_governance_vote_events_proposal" ON "governance_vote_events" ("proposal_id","proposal_version","created_at");

CREATE TABLE IF NOT EXISTS "governance_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"scope" text DEFAULT 'team' NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"chambers_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"created_at" text NOT NULL,
	"revoked_at" text,
	"expires_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_governance_delegations_team_status" ON "governance_delegations" ("team_id","status");
CREATE INDEX IF NOT EXISTS "idx_governance_delegations_from" ON "governance_delegations" ("from_user_id","status");
CREATE INDEX IF NOT EXISTS "idx_governance_delegations_to" ON "governance_delegations" ("to_user_id","status");

CREATE TABLE IF NOT EXISTS "governance_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"proposal_id" text NOT NULL,
	"proposal_version" integer NOT NULL,
	"proposal_content_hash" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"content_decision_slug" text,
	"governance_provider_id" text NOT NULL,
	"governance_rule_json" text DEFAULT '{}' NOT NULL,
	"electorate_snapshot_id" text,
	"vote_result_json" text DEFAULT '{}' NOT NULL,
	"voter_reasons_json" text DEFAULT '[]' NOT NULL,
	"proposal_snapshot_json" text DEFAULT '{}' NOT NULL,
	"decision_record_json" text DEFAULT '{}' NOT NULL,
	"created_by_type" text DEFAULT 'system' NOT NULL,
	"created_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"superseded_at" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_governance_decisions_proposal" ON "governance_decisions" ("proposal_id");
CREATE INDEX IF NOT EXISTS "idx_governance_decisions_project_status" ON "governance_decisions" ("project_id","status","updated_at");

CREATE TABLE IF NOT EXISTS "governance_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"team_id" text NOT NULL,
	"project_id" text,
	"proposal_id" text,
	"decision_id" text,
	"proposal_version" integer,
	"prior_state" text,
	"next_state" text,
	"message" text,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_governance_events_proposal" ON "governance_events" ("proposal_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_governance_events_decision" ON "governance_events" ("decision_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_governance_events_team" ON "governance_events" ("team_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_governance_events_project" ON "governance_events" ("project_id","created_at");
