CREATE TABLE IF NOT EXISTS "structured_agent_estimates" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text,
	"proposal_id" text,
	"work_unit_id" text,
	"agent_class" text NOT NULL,
	"agent_id" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"estimate_json" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"accepted_at" text,
	"rejected_at" text
);
CREATE INDEX IF NOT EXISTS "idx_structured_agent_estimates_decision" ON "structured_agent_estimates" ("decision_id","status","created_at");

CREATE TABLE IF NOT EXISTS "decision_assignment_graphs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"active" integer DEFAULT 0 NOT NULL,
	"graph_json" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"compiled_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_decision_assignment_graphs_decision" ON "decision_assignment_graphs" ("decision_id","active","version");

CREATE TABLE IF NOT EXISTS "deliverable_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"deliverable_type" text NOT NULL,
	"status" text NOT NULL,
	"contract_json" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_deliverable_contracts_decision" ON "deliverable_contracts" ("decision_id","status","deliverable_type");

CREATE TABLE IF NOT EXISTS "deliverable_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"deliverable_contract_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"ready_for_review" integer DEFAULT 0 NOT NULL,
	"manifest_json" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"submitted_at" text,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_deliverable_manifests_contract" ON "deliverable_manifests" ("deliverable_contract_id","submitted_at");
