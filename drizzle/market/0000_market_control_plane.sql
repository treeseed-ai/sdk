CREATE TABLE IF NOT EXISTS "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "agent_pool_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"project_id" text NOT NULL,
	"runner_id" text,
	"manager_id" text,
	"service_name" text,
	"heartbeat_at" text NOT NULL,
	"desired_workers" integer,
	"observed_queue_depth" integer,
	"observed_active_leases" integer,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "agent_pool_scale_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"desired_workers" integer NOT NULL,
	"observed_queue_depth" integer DEFAULT 0 NOT NULL,
	"observed_active_leases" integer DEFAULT 0 NOT NULL,
	"work_day_id" text,
	"reason" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "agent_pools" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"environment" text NOT NULL,
	"name" text NOT NULL,
	"registration_identity" text,
	"service_base_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"min_workers" integer DEFAULT 0 NOT NULL,
	"max_workers" integer DEFAULT 1 NOT NULL,
	"target_queue_depth" integer DEFAULT 1 NOT NULL,
	"cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "agent_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"agent_slug" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes_json" text NOT NULL,
	"expires_at" text,
	"last_used_at" text,
	"revoked_at" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_day_id" text,
	"task_id" text,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"requested_by_type" text DEFAULT 'worker' NOT NULL,
	"requested_by_id" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"options_json" text DEFAULT '[]' NOT NULL,
	"recommendation_json" text DEFAULT '{}' NOT NULL,
	"policy_snapshot_json" text DEFAULT '{}' NOT NULL,
	"expires_at" text,
	"decided_by_type" text,
	"decided_by_id" text,
	"decided_at" text,
	"decision_json" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"event_type" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"data_json" text,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_type" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"scopes_json" text NOT NULL,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"data_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "better_auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" bigint,
	"refreshTokenExpiresAt" bigint,
	"scope" text,
	"password" text,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS "better_auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" bigint NOT NULL,
	"token" text NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "better_auth_session_token_unique" UNIQUE("token")
);

CREATE TABLE IF NOT EXISTS "better_auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" integer DEFAULT 0 NOT NULL,
	"image" text,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"username" text,
	"firstName" text,
	"lastName" text,
	CONSTRAINT "better_auth_user_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "better_auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" bigint NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"lane_id" text,
	"grant_scope" text DEFAULT 'team' NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"environment" text,
	"state" text DEFAULT 'active' NOT NULL,
	"daily_credit_limit" real,
	"weekly_credit_limit" real,
	"monthly_credit_limit" real,
	"daily_usd_limit" real,
	"weekly_quota_minutes" real,
	"monthly_provider_units" real,
	"priority_weight" real DEFAULT 1 NOT NULL,
	"overflow_policy" text DEFAULT 'soft_grant' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"lane_id" text,
	"reservation_id" text,
	"team_id" text NOT NULL,
	"project_id" text,
	"work_day_id" text,
	"task_id" text,
	"phase" text NOT NULL,
	"credits" real NOT NULL,
	"provider_units" real,
	"usd" real,
	"source" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_provider_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" text,
	"rotated_from_key_id" text,
	"expires_at" text,
	"revoked_at" text,
	"created_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_provider_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"launch_mode" text NOT NULL,
	"host_kind" text NOT NULL,
	"host_id" text,
	"status" text NOT NULL,
	"image_ref" text,
	"service_refs_json" text DEFAULT '{}' NOT NULL,
	"env_refs_json" text DEFAULT '{}' NOT NULL,
	"result_json" text DEFAULT '{}' NOT NULL,
	"error_json" text,
	"created_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);

CREATE TABLE IF NOT EXISTS "capacity_provider_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"host_id" text NOT NULL,
	"role" text NOT NULL,
	"required" integer DEFAULT 1 NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_provider_lanes" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"name" text NOT NULL,
	"business_model" text DEFAULT 'custom' NOT NULL,
	"model_family" text,
	"model_class" text,
	"region_policy" text,
	"unit" text DEFAULT 'treeseed_credit' NOT NULL,
	"scarcity_level" text DEFAULT 'medium' NOT NULL,
	"hard_limits_json" text DEFAULT '{}' NOT NULL,
	"routing_policy_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_provider_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"team_id" text NOT NULL,
	"runtime_version" text NOT NULL,
	"market_id" text NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"budgets_json" text DEFAULT '{}' NOT NULL,
	"health_json" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"registered_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"disconnected_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"owner_team_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"billing_scope" text DEFAULT 'team' NOT NULL,
	"monthly_credit_budget" real DEFAULT 0 NOT NULL,
	"daily_credit_budget" real DEFAULT 0 NOT NULL,
	"credit_budget_mode" text DEFAULT 'derived' NOT NULL,
	"max_concurrent_workdays" integer DEFAULT 1 NOT NULL,
	"max_concurrent_workers" integer DEFAULT 1 NOT NULL,
	"capacity_model_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"execution_provider_id" text,
	"lane_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_day_id" text,
	"task_id" text,
	"state" text DEFAULT 'reserved' NOT NULL,
	"reserved_credits" real NOT NULL,
	"consumed_credits" real DEFAULT 0 NOT NULL,
	"native_unit" text,
	"reserved_native_amount" real,
	"consumed_native_amount" real,
	"reserved_provider_units" real,
	"consumed_provider_units" real,
	"reserved_usd" real,
	"consumed_usd" real,
	"expires_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "capacity_routing_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"work_day_id" text,
	"project_id" text NOT NULL,
	"selected_provider_id" text NOT NULL,
	"selected_lane_id" text NOT NULL,
	"selected_model" text,
	"decision" text DEFAULT 'selected' NOT NULL,
	"reason" text NOT NULL,
	"candidate_json" text DEFAULT '[]' NOT NULL,
	"score_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "catalog_artifact_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"content_key" text NOT NULL,
	"manifest_key" text,
	"metadata_json" text,
	"published_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "catalog_item_collaborators" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"role" text NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"visibility" text NOT NULL,
	"listing_enabled" integer DEFAULT 0 NOT NULL,
	"offer_mode" text NOT NULL,
	"manifest_key" text,
	"artifact_key" text,
	"search_text" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "contact_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "credit_conversion_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"task_signature" text NOT NULL,
	"execution_profile_id" text DEFAULT 'standard-code-model' NOT NULL,
	"execution_provider_kind" text NOT NULL,
	"native_unit" text NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"completed_sample_count" integer DEFAULT 0 NOT NULL,
	"interrupted_sample_count" integer DEFAULT 0 NOT NULL,
	"native_units_per_credit_p50" real,
	"native_units_per_credit_p90" real,
	"credits_per_native_unit_p50" real,
	"credits_per_native_unit_p90" real,
	"actual_credits_p50" real,
	"actual_credits_p90" real,
	"confidence" text DEFAULT 'low' NOT NULL,
	"formula_version" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "cursor_state" (
	"agent_slug" text,
	"cursor_key" text,
	"status" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"updated_at" text NOT NULL,
	"payload_json" text NOT NULL,
	"meta_json" text NOT NULL,
	CONSTRAINT "cursor_state_agent_slug_cursor_key_pk" PRIMARY KEY("agent_slug","cursor_key")
);

CREATE TABLE IF NOT EXISTS "device_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"requested_scopes_json" text NOT NULL,
	"expires_at" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"status" text NOT NULL,
	"user_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "device_codes_device_code_unique" UNIQUE("device_code"),
	CONSTRAINT "device_codes_user_code_unique" UNIQUE("user_code")
);

CREATE TABLE IF NOT EXISTS "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"project_id" text,
	"tier" text NOT NULL,
	"status" text NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "execution_provider_native_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_provider_id" text NOT NULL,
	"scope" text NOT NULL,
	"native_unit" text NOT NULL,
	"limit_amount" real NOT NULL,
	"reserve_buffer_percent" real DEFAULT 0 NOT NULL,
	"reset_cadence" text,
	"reset_at" text,
	"confidence" text DEFAULT 'estimated' NOT NULL,
	"source" text DEFAULT 'configured' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "execution_provider_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_provider_id" text NOT NULL,
	"observed_at" text NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"active_workers" integer,
	"queued_tasks" integer,
	"throttle_state" text,
	"native_remaining_json" text DEFAULT '{}' NOT NULL,
	"reset_at" text,
	"confidence" text DEFAULT 'estimated' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "execution_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"native_unit" text NOT NULL,
	"quota_visibility" text DEFAULT 'opaque' NOT NULL,
	"max_concurrent_workers" integer DEFAULT 1 NOT NULL,
	"reset_cadence" text,
	"config_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "graph_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"work_day_id" text NOT NULL,
	"corpus_hash" text NOT NULL,
	"graph_version" text NOT NULL,
	"query_json" text,
	"seed_ids_json" text,
	"selected_node_ids_json" text,
	"stats_json" text,
	"snapshot_ref" text,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "hub_content_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"team_id" text NOT NULL,
	"content_repository_id" text,
	"production_source" text NOT NULL,
	"overlay_policy" text NOT NULL,
	"r2_bucket_name" text,
	"r2_manifest_key" text,
	"r2_public_base_url" text,
	"latest_publish_id" text,
	"latest_content_version" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "hub_content_sources_hub_id_unique" UNIQUE("hub_id")
);

CREATE TABLE IF NOT EXISTS "hub_launch_events" (
	"id" text PRIMARY KEY NOT NULL,
	"launch_id" text NOT NULL,
	"seq" integer NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"title" text,
	"summary" text,
	"started_at" text,
	"finished_at" text,
	"error_json" text,
	"data_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "hub_launches" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"team_id" text NOT NULL,
	"job_id" text,
	"intent_json" text NOT NULL,
	"plan_json" text DEFAULT '{}' NOT NULL,
	"state" text NOT NULL,
	"current_phase" text,
	"last_successful_phase" text,
	"result_json" text,
	"error_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);

CREATE TABLE IF NOT EXISTS "hub_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"team_id" text NOT NULL,
	"role" text NOT NULL,
	"repository_host_id" text,
	"provider" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"default_branch" text,
	"current_branch" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"access_policy_json" text DEFAULT '{}' NOT NULL,
	"release_policy_json" text DEFAULT '{}' NOT NULL,
	"publish_policy_json" text DEFAULT '{}' NOT NULL,
	"submodule_path" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "hub_workspace_links" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"team_id" text NOT NULL,
	"parent_repository_host_id" text,
	"parent_owner" text,
	"parent_name" text,
	"parent_url" text,
	"parent_branch" text,
	"hub_mount_path" text,
	"software_submodule_path" text,
	"content_submodule_path" text,
	"update_submodule_pointers_enabled" integer DEFAULT 0 NOT NULL,
	"access_policy_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "knowledge_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"source_kind" text NOT NULL,
	"source_ref" text,
	"install_strategy" text NOT NULL,
	"visibility" text NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "knowledge_packs_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "lease_state" (
	"model" text,
	"item_key" text,
	"status" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"claimed_by" text,
	"claimed_at" text,
	"lease_expires_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"payload_json" text NOT NULL,
	"meta_json" text NOT NULL,
	CONSTRAINT "lease_state_model_item_key_pk" PRIMARY KEY("model","item_key")
);

CREATE TABLE IF NOT EXISTS "market_auth_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "market_auth_credentials_email_unique" UNIQUE("email"),
	CONSTRAINT "market_auth_credentials_username_unique" UNIQUE("username")
);

CREATE TABLE IF NOT EXISTS "market_auth_password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "market_auth_password_resets_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE IF NOT EXISTS "market_operation_runners" (
	"id" text PRIMARY KEY NOT NULL,
	"runner_key" text NOT NULL,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"version" text,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"active_job_count" integer DEFAULT 0 NOT NULL,
	"max_concurrent_jobs" integer DEFAULT 1 NOT NULL,
	"heartbeat_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "market_operation_runners_runner_key_unique" UNIQUE("runner_key")
);

CREATE TABLE IF NOT EXISTS "message_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_type" text NOT NULL,
	"status" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"related_model" text,
	"related_id" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"available_at" text NOT NULL,
	"claimed_by" text,
	"claimed_at" text,
	"lease_expires_at" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"payload_json" text NOT NULL,
	"meta_json" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "native_usage_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"task_usage_actual_id" text,
	"task_id" text,
	"work_day_id" text,
	"project_id" text NOT NULL,
	"task_signature" text NOT NULL,
	"execution_profile_id" text DEFAULT 'standard-code-model' NOT NULL,
	"capacity_provider_id" text,
	"execution_provider_id" text,
	"native_unit" text,
	"native_usage_json" text DEFAULT '{}' NOT NULL,
	"observed_at" text NOT NULL,
	"source" text DEFAULT 'provider_report' NOT NULL,
	"formula_version" text DEFAULT 'treeseed.actual-credits.v1' NOT NULL,
	"actual_credits" real NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"scope" text NOT NULL,
	"description" text,
	"created_at" text NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);

CREATE TABLE IF NOT EXISTS "platform_operation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"data_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "platform_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"target" text NOT NULL,
	"idempotency_key" text,
	"input_json" text DEFAULT '{}' NOT NULL,
	"output_json" text,
	"error_json" text,
	"requested_by_type" text NOT NULL,
	"requested_by_id" text,
	"assigned_runner_id" text,
	"lease_expires_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"started_at" text,
	"finished_at" text,
	"cancelled_at" text
);

CREATE TABLE IF NOT EXISTS "platform_repository_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_key" text NOT NULL,
	"runner_id" text NOT NULL,
	"workspace_path" text NOT NULL,
	"branch" text,
	"commit_sha" text,
	"claim_state" text DEFAULT 'active' NOT NULL,
	"lease_expires_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "priority_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"model" text NOT NULL,
	"subject_id" text NOT NULL,
	"priority" real DEFAULT 0 NOT NULL,
	"estimated_credits" real,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "priority_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"work_day_id" text,
	"snapshot_json" text NOT NULL,
	"metadata_json" text NOT NULL,
	"generated_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_capability_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"label" text,
	"namespace" text NOT NULL,
	"operation" text NOT NULL,
	"execution_class" text NOT NULL,
	"allowed_targets_json" text NOT NULL,
	"default_dispatch_mode" text NOT NULL,
	"approval_policy_json" text DEFAULT '{}' NOT NULL,
	"resource_scope_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"mode" text NOT NULL,
	"project_api_base_url" text,
	"execution_owner" text NOT NULL,
	"runner_registration_state" text DEFAULT 'pending' NOT NULL,
	"runner_key_prefix" text,
	"runner_key_hash" text,
	"runner_registered_at" text,
	"runner_last_seen_at" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_connections_project_id_unique" UNIQUE("project_id")
);

CREATE TABLE IF NOT EXISTS "project_deployment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"operation_id" text,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"status" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"sequence" integer NOT NULL,
	"payload_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"deployment_kind" text NOT NULL,
	"action" text DEFAULT 'deploy_web' NOT NULL,
	"status" text NOT NULL,
	"platform_operation_id" text,
	"retry_of_deployment_id" text,
	"resumed_from_deployment_id" text,
	"idempotency_key" text,
	"requested_by_user_id" text,
	"source_ref" text,
	"release_tag" text,
	"commit_sha" text,
	"triggered_by_type" text,
	"triggered_by_id" text,
	"repository_json" text DEFAULT '{}' NOT NULL,
	"external_workflow_json" text DEFAULT '{}' NOT NULL,
	"target_json" text DEFAULT '{}' NOT NULL,
	"monitor_json" text DEFAULT '{}' NOT NULL,
	"summary" text,
	"error_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text,
	"started_at" text,
	"finished_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);

CREATE TABLE IF NOT EXISTS "project_environments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"deployment_profile" text NOT NULL,
	"base_url" text,
	"cloudflare_account_id" text,
	"pages_project_name" text,
	"worker_name" text,
	"r2_bucket_name" text,
	"d1_database_name" text,
	"queue_name" text,
	"railway_project_name" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_hosting" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"hosting_kind" text NOT NULL,
	"registration" text DEFAULT 'none' NOT NULL,
	"market_base_url" text,
	"source_repo_owner" text,
	"source_repo_name" text,
	"source_repo_url" text,
	"source_repo_workflow_path" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "project_hosting_project_id_unique" UNIQUE("project_id")
);

CREATE TABLE IF NOT EXISTS "project_infrastructure_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"provider" text NOT NULL,
	"resource_kind" text NOT NULL,
	"logical_name" text NOT NULL,
	"locator" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_summary_snapshots" (
	"project_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"summary_json" text NOT NULL,
	"generated_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_update_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"team_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text,
	"source_version" text,
	"plan_json" text DEFAULT '{}' NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"requires_decision" integer DEFAULT 0 NOT NULL,
	"decision_id" text,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_workday_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"work_day_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text,
	"started_at" text,
	"ended_at" text,
	"summary_json" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "provider_credential_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"job_id" text,
	"host_kind" text NOT NULL,
	"host_id" text NOT NULL,
	"purpose" text NOT NULL,
	"encrypted_payload_json" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL
);

CREATE TABLE IF NOT EXISTS "remote_job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"data_json" text,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "remote_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"namespace" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"preferred_mode" text NOT NULL,
	"selected_target" text NOT NULL,
	"capability_json" text NOT NULL,
	"input_json" text NOT NULL,
	"output_json" text,
	"error_json" text,
	"requested_by_type" text NOT NULL,
	"requested_by_id" text,
	"assigned_runner_id" text,
	"idempotency_key" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"started_at" text,
	"finished_at" text,
	"cancelled_at" text
);

CREATE TABLE IF NOT EXISTS "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"work_day_id" text NOT NULL,
	"kind" text NOT NULL,
	"body_json" text NOT NULL,
	"rendered_ref" text,
	"sent_at" text,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "repository_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"runner_id" text NOT NULL,
	"runner_service_name" text NOT NULL,
	"volume_identity" text NOT NULL,
	"last_seen_commit" text,
	"last_task_at" text,
	"claim_state" text DEFAULT 'active' NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "repository_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"provider" text NOT NULL,
	"ownership" text NOT NULL,
	"name" text NOT NULL,
	"account_label" text,
	"organization_or_owner" text NOT NULL,
	"default_visibility" text DEFAULT 'private' NOT NULL,
	"software_repository_name_template" text DEFAULT '{hub}-site' NOT NULL,
	"content_repository_name_template" text DEFAULT '{hub}-content' NOT NULL,
	"branch_policy_json" text DEFAULT '{}' NOT NULL,
	"workflow_policy_json" text DEFAULT '{}' NOT NULL,
	"encrypted_payload_json" text,
	"allowed_project_kinds_json" text DEFAULT '["knowledge_hub"]' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" text,
	"permission_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);

CREATE TABLE IF NOT EXISTS "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"created_at" text NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);

CREATE TABLE IF NOT EXISTS "runner_scale_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"work_day_id" text,
	"runner_id" text,
	"runner_service_name" text,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "runtime_envelopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"record_type" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "runtime_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"record_type" text NOT NULL,
	"record_key" text NOT NULL,
	"lookup_key" text,
	"secondary_key" text,
	"status" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"payload_json" text NOT NULL,
	"meta_json" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "scale_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"pool_name" text NOT NULL,
	"work_day_id" text,
	"desired_workers" integer NOT NULL,
	"observed_queue_depth" integer DEFAULT 0 NOT NULL,
	"observed_active_leases" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "seed_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"seed_name" text NOT NULL,
	"seed_version" integer NOT NULL,
	"environments_json" text NOT NULL,
	"mode" text NOT NULL,
	"state" text NOT NULL,
	"actor_type" text,
	"actor_id" text,
	"manifest_hash" text NOT NULL,
	"plan_json" text NOT NULL,
	"result_json" text,
	"error_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);

CREATE TABLE IF NOT EXISTS "service_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"roles_json" text NOT NULL,
	"permissions_json" text NOT NULL,
	"revoked_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"last_used_at" text,
	CONSTRAINT "service_credentials_service_id_unique" UNIQUE("service_id")
);

CREATE TABLE IF NOT EXISTS "subscribers" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "task_credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"work_day_id" text NOT NULL,
	"task_id" text,
	"phase" text NOT NULL,
	"credits" real NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "task_estimate_profiles" (
	"task_signature" text,
	"execution_profile_id" text DEFAULT 'standard-code-model',
	"sample_count" integer DEFAULT 0 NOT NULL,
	"completed_sample_count" integer DEFAULT 0 NOT NULL,
	"interrupted_sample_count" integer DEFAULT 0 NOT NULL,
	"input_tokens_p50" integer,
	"input_tokens_p90" integer,
	"output_tokens_p50" integer,
	"output_tokens_p90" integer,
	"quota_minutes_p50" real,
	"quota_minutes_p90" real,
	"files_changed_p50" real,
	"files_changed_p90" real,
	"credits_p50" real,
	"credits_p90" real,
	"credits_variance" real,
	"confidence_score" real,
	"outlier_count" integer DEFAULT 0 NOT NULL,
	"partial_credits" real,
	"first_sample_at" text,
	"last_sample_at" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "task_estimate_profiles_task_signature_execution_profile_id_pk" PRIMARY KEY("task_signature","execution_profile_id")
);

CREATE TABLE IF NOT EXISTS "task_estimates" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"work_day_id" text,
	"project_id" text NOT NULL,
	"estimate_phase" text NOT NULL,
	"task_signature" text NOT NULL,
	"confidence" text NOT NULL,
	"estimated_credits_p50" real NOT NULL,
	"estimated_credits_p90" real NOT NULL,
	"reserved_credits" real NOT NULL,
	"estimated_input_tokens_p50" integer,
	"estimated_input_tokens_p90" integer,
	"estimated_output_tokens_p50" integer,
	"estimated_output_tokens_p90" integer,
	"estimated_quota_minutes_p50" real,
	"estimated_quota_minutes_p90" real,
	"features_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"execution_profile_id" text DEFAULT 'standard-code-model' NOT NULL
);

CREATE TABLE IF NOT EXISTS "task_events" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"data_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "task_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"output_json" text NOT NULL,
	"output_ref" text,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "task_usage_actuals" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"work_day_id" text,
	"project_id" text NOT NULL,
	"task_signature" text NOT NULL,
	"capacity_provider_id" text,
	"execution_provider_id" text,
	"lane_id" text,
	"business_model" text NOT NULL,
	"model_name" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"quota_minutes" real,
	"wall_minutes" real,
	"files_opened" integer,
	"files_changed" integer,
	"diff_lines_added" integer,
	"diff_lines_removed" integer,
	"test_runs" integer,
	"retry_count" integer,
	"actual_credits" real NOT NULL,
	"actual_usd" real,
	"credit_formula_version" text DEFAULT 'treeseed.actual-credits.v1' NOT NULL,
	"actual_credit_source" text DEFAULT 'central_calculator' NOT NULL,
	"native_usage_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"execution_profile_id" text DEFAULT 'standard-code-model' NOT NULL
);

CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"work_day_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"type" text NOT NULL,
	"state" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_json" text NOT NULL,
	"payload_hash" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"claimed_by" text,
	"lease_expires_at" text,
	"available_at" text NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"graph_version" text,
	"parent_task_id" text,
	"created_at" text NOT NULL,
	"started_at" text,
	"completed_at" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "tasks_idempotency_key_unique" UNIQUE("idempotency_key")
);

CREATE TABLE IF NOT EXISTS "team_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"permissions_json" text NOT NULL,
	"expires_at" text,
	"last_used_at" text,
	"revoked_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_inbox_items" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"href" text,
	"item_key" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"email" text NOT NULL,
	"role_key" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" text,
	"accepted_by_user_id" text,
	"accepted_at" text,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_role_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"team_membership_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_storage_locators" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"bucket_name" text NOT NULL,
	"manifest_key_template" text NOT NULL,
	"preview_root_template" text NOT NULL,
	"public_base_url" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "team_storage_locators_team_id_unique" UNIQUE("team_id")
);

CREATE TABLE IF NOT EXISTS "team_web_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"provider" text NOT NULL,
	"ownership" text NOT NULL,
	"name" text NOT NULL,
	"account_label" text,
	"allowed_environments_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"encrypted_payload_json" text,
	"metadata_json" text,
	"created_by_id" text,
	"updated_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"display_name" text,
	"logo_url" text,
	"profile_summary" text,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "user_email_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_primary" integer DEFAULT 0 NOT NULL,
	"verification_requested_at" text,
	"verified_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "user_email_addresses_normalized_email_unique" UNIQUE("normalized_email")
);

CREATE TABLE IF NOT EXISTS "user_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text,
	"email_verified" integer DEFAULT 0 NOT NULL,
	"profile_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"color_scheme" text DEFAULT 'fern' NOT NULL,
	"theme_mode" text DEFAULT 'system' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_role_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"username" text
);

CREATE TABLE IF NOT EXISTS "web_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"identity_id" text,
	"better_auth_session_id" text,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text,
	"display_name" text,
	"principal_json" text NOT NULL,
	"csrf_token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"authenticated_at" text NOT NULL,
	"last_seen_at" text,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "work_days" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"state" text NOT NULL,
	"capacity_budget" integer DEFAULT 0 NOT NULL,
	"capacity_used" integer DEFAULT 0 NOT NULL,
	"graph_version" text,
	"summary_json" text,
	"started_at" text NOT NULL,
	"ended_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "work_policies" (
	"project_id" text,
	"environment" text,
	"schedule_json" text NOT NULL,
	"daily_task_credit_budget" integer DEFAULT 0 NOT NULL,
	"max_queued_tasks" integer DEFAULT 0 NOT NULL,
	"max_queued_credits" integer DEFAULT 0 NOT NULL,
	"autoscale_json" text NOT NULL,
	"credit_weights_json" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"start_cron" text DEFAULT '0 9 * * 1-5' NOT NULL,
	"duration_minutes" integer DEFAULT 480 NOT NULL,
	"max_runners" integer DEFAULT 1 NOT NULL,
	"max_workers_per_runner" integer DEFAULT 4 NOT NULL,
	"daily_credit_budget" integer DEFAULT 0 NOT NULL,
	"closeout_grace_minutes" integer DEFAULT 15 NOT NULL,
	CONSTRAINT "work_policies_project_id_environment_pk" PRIMARY KEY("project_id","environment")
);

CREATE TABLE IF NOT EXISTS "workday_manager_leases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"work_day_id" text,
	"manager_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"heartbeat_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "workday_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"type" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"work_day_id" text,
	"requested_by" text,
	"reason" text,
	"payload_json" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "worker_runners" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"runner_id" text NOT NULL,
	"runner_service_name" text NOT NULL,
	"volume_identity" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"max_local_workers" integer DEFAULT 4 NOT NULL,
	"active_local_workers" integer DEFAULT 0 NOT NULL,
	"available_capacity" integer DEFAULT 4 NOT NULL,
	"last_heartbeat_at" text,
	"claimed_repository_ids_json" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

-- Treeseed Market schema adoption columns
ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "id" integer;
ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "type" text;
ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "payload_json" text;
ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "pool_id" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "runner_id" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "manager_id" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "service_name" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "heartbeat_at" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "desired_workers" integer;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "observed_queue_depth" integer;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "observed_active_leases" integer;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "agent_pool_registrations" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "pool_id" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "desired_workers" integer;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "observed_queue_depth" integer DEFAULT 0;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "observed_active_leases" integer DEFAULT 0;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "agent_pool_scale_decisions" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "registration_identity" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "service_base_url" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending';
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "min_workers" integer DEFAULT 0;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "max_workers" integer DEFAULT 1;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "target_queue_depth" integer DEFAULT 1;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "cooldown_seconds" integer DEFAULT 60;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "agent_pools" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "run_id" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "agent_slug" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "token_prefix" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "token_hash" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "scopes_json" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "last_used_at" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "revoked_at" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'pending';
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'medium';
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "requested_by_type" text DEFAULT 'worker';
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "requested_by_id" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "options_json" text DEFAULT '[]';
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "recommendation_json" text DEFAULT '{}';
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "policy_snapshot_json" text DEFAULT '{}';
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "decided_by_type" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "decided_by_id" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "decided_at" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "decision_json" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "actor_type" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "actor_id" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "event_type" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "target_type" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "target_id" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "data_json" text;
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "session_type" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "refresh_token_hash" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "scopes_json" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "revoked_at" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "data_json" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "accountId" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "providerId" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "accessToken" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "refreshToken" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "idToken" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt" integer;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" integer;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "scope" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "password" text;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "createdAt" integer;
ALTER TABLE "better_auth_account" ADD COLUMN IF NOT EXISTS "updatedAt" integer;
ALTER TABLE "better_auth_session" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "better_auth_session" ADD COLUMN IF NOT EXISTS "expiresAt" integer;
ALTER TABLE "better_auth_session" ADD COLUMN IF NOT EXISTS "token" text;
ALTER TABLE "better_auth_session" ADD COLUMN IF NOT EXISTS "createdAt" integer;
ALTER TABLE "better_auth_session" ADD COLUMN IF NOT EXISTS "updatedAt" integer;
ALTER TABLE "better_auth_session" ADD COLUMN IF NOT EXISTS "ipAddress" text;
ALTER TABLE "better_auth_session" ADD COLUMN IF NOT EXISTS "userAgent" text;
ALTER TABLE "better_auth_session" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "emailVerified" integer DEFAULT 0;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "image" text;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "createdAt" integer;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "updatedAt" integer;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "firstName" text;
ALTER TABLE "better_auth_user" ADD COLUMN IF NOT EXISTS "lastName" text;
ALTER TABLE "better_auth_verification" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "better_auth_verification" ADD COLUMN IF NOT EXISTS "identifier" text;
ALTER TABLE "better_auth_verification" ADD COLUMN IF NOT EXISTS "value" text;
ALTER TABLE "better_auth_verification" ADD COLUMN IF NOT EXISTS "expiresAt" integer;
ALTER TABLE "better_auth_verification" ADD COLUMN IF NOT EXISTS "createdAt" integer;
ALTER TABLE "better_auth_verification" ADD COLUMN IF NOT EXISTS "updatedAt" integer;
ALTER TABLE "better_auth_verification" ALTER COLUMN "expiresAt" TYPE bigint;
ALTER TABLE "better_auth_verification" ALTER COLUMN "createdAt" TYPE bigint;
ALTER TABLE "better_auth_verification" ALTER COLUMN "updatedAt" TYPE bigint;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "lane_id" text;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "grant_scope" text DEFAULT 'team';
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'active';
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "daily_credit_limit" real;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "weekly_credit_limit" real;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "monthly_credit_limit" real;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "daily_usd_limit" real;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "weekly_quota_minutes" real;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "monthly_provider_units" real;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "priority_weight" real DEFAULT 1;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "overflow_policy" text DEFAULT 'soft_grant';
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_grants" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "lane_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "reservation_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "phase" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "credits" real;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "provider_units" real;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "usd" real;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "source" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "key_prefix" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "key_hash" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "scopes_json" text DEFAULT '[]';
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "last_used_at" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "rotated_from_key_id" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "revoked_at" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "created_by_id" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_provider_api_keys" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "launch_mode" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "host_kind" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "host_id" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "image_ref" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "service_refs_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "env_refs_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "result_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "error_json" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "created_by_id" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "capacity_provider_deployments" ADD COLUMN IF NOT EXISTS "completed_at" text;
ALTER TABLE "capacity_provider_hosts" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_provider_hosts" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "capacity_provider_hosts" ADD COLUMN IF NOT EXISTS "host_id" text;
ALTER TABLE "capacity_provider_hosts" ADD COLUMN IF NOT EXISTS "role" text;
ALTER TABLE "capacity_provider_hosts" ADD COLUMN IF NOT EXISTS "required" integer DEFAULT 1;
ALTER TABLE "capacity_provider_hosts" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_hosts" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_provider_hosts" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "business_model" text DEFAULT 'custom';
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "model_family" text;
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "model_class" text;
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "region_policy" text;
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "unit" text DEFAULT 'treeseed_credit';
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "scarcity_level" text DEFAULT 'medium';
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "hard_limits_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "routing_policy_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "runtime_version" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "market_id" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "capabilities_json" text DEFAULT '[]';
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "budgets_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "health_json" text DEFAULT '{}';
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'online';
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "registered_at" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "last_seen_at" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "disconnected_at" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_provider_registrations" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "owner_team_id" text;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending';
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "billing_scope" text DEFAULT 'team';
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "monthly_credit_budget" real DEFAULT 0;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "daily_credit_budget" real DEFAULT 0;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "credit_budget_mode" text DEFAULT 'derived';
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "max_concurrent_workdays" integer DEFAULT 1;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "max_concurrent_workers" integer DEFAULT 1;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "capacity_model_json" text DEFAULT '{}';
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_providers" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "execution_provider_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "lane_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'reserved';
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "reserved_credits" real;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "consumed_credits" real DEFAULT 0;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "native_unit" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "reserved_native_amount" real;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "consumed_native_amount" real;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "reserved_provider_units" real;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "consumed_provider_units" real;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "reserved_usd" real;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "consumed_usd" real;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "selected_provider_id" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "selected_lane_id" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "selected_model" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "decision" text DEFAULT 'selected';
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "candidate_json" text DEFAULT '[]';
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "score_json" text DEFAULT '{}';
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "capacity_routing_decisions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "item_id" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "version" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "content_key" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "manifest_key" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "published_at" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "catalog_artifact_versions" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "catalog_item_collaborators" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "catalog_item_collaborators" ADD COLUMN IF NOT EXISTS "item_id" text;
ALTER TABLE "catalog_item_collaborators" ADD COLUMN IF NOT EXISTS "subject_type" text;
ALTER TABLE "catalog_item_collaborators" ADD COLUMN IF NOT EXISTS "subject_id" text;
ALTER TABLE "catalog_item_collaborators" ADD COLUMN IF NOT EXISTS "role" text;
ALTER TABLE "catalog_item_collaborators" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "catalog_item_collaborators" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "catalog_item_collaborators" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "visibility" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "listing_enabled" integer DEFAULT 0;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "offer_mode" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "manifest_key" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "artifact_key" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "search_text" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "id" integer;
ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "message" text;
ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "task_signature" text;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "execution_profile_id" text DEFAULT 'standard-code-model';
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "execution_provider_kind" text;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "native_unit" text;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "sample_count" integer DEFAULT 0;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "completed_sample_count" integer DEFAULT 0;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "interrupted_sample_count" integer DEFAULT 0;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "native_units_per_credit_p50" real;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "native_units_per_credit_p90" real;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "credits_per_native_unit_p50" real;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "credits_per_native_unit_p90" real;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "actual_credits_p50" real;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "actual_credits_p90" real;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "confidence" text DEFAULT 'low';
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "formula_version" text;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "credit_conversion_profiles" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "cursor_state" ADD COLUMN IF NOT EXISTS "agent_slug" text;
ALTER TABLE "cursor_state" ADD COLUMN IF NOT EXISTS "cursor_key" text;
ALTER TABLE "cursor_state" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "cursor_state" ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1;
ALTER TABLE "cursor_state" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "cursor_state" ADD COLUMN IF NOT EXISTS "payload_json" text;
ALTER TABLE "cursor_state" ADD COLUMN IF NOT EXISTS "meta_json" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "device_code" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "user_code" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "requested_scopes_json" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "interval_seconds" integer;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "device_codes" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "tier" text;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "execution_provider_id" text;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "scope" text;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "native_unit" text;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "limit_amount" real;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "reserve_buffer_percent" real DEFAULT 0;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "reset_cadence" text;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "reset_at" text;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "confidence" text DEFAULT 'estimated';
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'configured';
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "execution_provider_native_limits" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "execution_provider_id" text;
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "observed_at" text;
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "health" text DEFAULT 'unknown';
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "active_workers" integer;
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "queued_tasks" integer;
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "throttle_state" text;
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "native_remaining_json" text DEFAULT '{}';
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "reset_at" text;
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "confidence" text DEFAULT 'estimated';
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "execution_provider_observations" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "native_unit" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "quota_visibility" text DEFAULT 'opaque';
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "max_concurrent_workers" integer DEFAULT 1;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "reset_cadence" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "config_json" text DEFAULT '{}';
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "execution_providers" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "corpus_hash" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "graph_version" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "query_json" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "seed_ids_json" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "selected_node_ids_json" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "stats_json" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "snapshot_ref" text;
ALTER TABLE "graph_runs" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "hub_id" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "content_repository_id" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "production_source" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "overlay_policy" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "r2_bucket_name" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "r2_manifest_key" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "r2_public_base_url" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "latest_publish_id" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "latest_content_version" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "hub_content_sources" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "launch_id" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "seq" integer;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "phase" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "started_at" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "finished_at" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "error_json" text;
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "data_json" text DEFAULT '{}';
ALTER TABLE "hub_launch_events" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "hub_id" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "job_id" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "intent_json" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "plan_json" text DEFAULT '{}';
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "current_phase" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "last_successful_phase" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "result_json" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "error_json" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "hub_launches" ADD COLUMN IF NOT EXISTS "completed_at" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "hub_id" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "role" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "repository_host_id" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "owner" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "url" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "default_branch" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "current_branch" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'queued';
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "access_policy_json" text DEFAULT '{}';
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "release_policy_json" text DEFAULT '{}';
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "publish_policy_json" text DEFAULT '{}';
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "submodule_path" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "hub_repositories" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "hub_id" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "parent_repository_host_id" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "parent_owner" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "parent_name" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "parent_url" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "parent_branch" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "hub_mount_path" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "software_submodule_path" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "content_submodule_path" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "update_submodule_pointers_enabled" integer DEFAULT 0;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "access_policy_json" text DEFAULT '{}';
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "hub_workspace_links" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "source_kind" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "source_ref" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "install_strategy" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "visibility" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "knowledge_packs" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "item_key" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "claimed_by" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "claimed_at" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "lease_expires_at" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "payload_json" text;
ALTER TABLE "lease_state" ADD COLUMN IF NOT EXISTS "meta_json" text;
ALTER TABLE "market_auth_credentials" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "market_auth_credentials" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "market_auth_credentials" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "market_auth_credentials" ADD COLUMN IF NOT EXISTS "password_hash" text;
ALTER TABLE "market_auth_credentials" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "market_auth_credentials" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "market_auth_credentials" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "market_auth_password_resets" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "market_auth_password_resets" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "market_auth_password_resets" ADD COLUMN IF NOT EXISTS "token_hash" text;
ALTER TABLE "market_auth_password_resets" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "market_auth_password_resets" ADD COLUMN IF NOT EXISTS "used_at" text;
ALTER TABLE "market_auth_password_resets" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "runner_key" text;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'online';
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "version" text;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "capabilities_json" text DEFAULT '[]';
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "active_job_count" integer DEFAULT 0;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "max_concurrent_jobs" integer DEFAULT 1;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "heartbeat_at" text;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "market_operation_runners" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "id" integer;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "message_type" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "related_model" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "related_id" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 0;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "available_at" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "claimed_by" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "claimed_at" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "lease_expires_at" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 3;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "payload_json" text;
ALTER TABLE "message_queue" ADD COLUMN IF NOT EXISTS "meta_json" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "task_usage_actual_id" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "task_signature" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "execution_profile_id" text DEFAULT 'standard-code-model';
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "execution_provider_id" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "native_unit" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "native_usage_json" text DEFAULT '{}';
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "observed_at" text;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'provider_report';
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "formula_version" text DEFAULT 'treeseed.actual-credits.v1';
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "actual_credits" real;
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "native_usage_observations" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "key" text;
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "resource" text;
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "action" text;
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "scope" text;
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "platform_operation_events" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "platform_operation_events" ADD COLUMN IF NOT EXISTS "operation_id" text;
ALTER TABLE "platform_operation_events" ADD COLUMN IF NOT EXISTS "seq" integer;
ALTER TABLE "platform_operation_events" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "platform_operation_events" ADD COLUMN IF NOT EXISTS "data_json" text DEFAULT '{}';
ALTER TABLE "platform_operation_events" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "namespace" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "operation" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "target" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "input_json" text DEFAULT '{}';
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "output_json" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "error_json" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "requested_by_type" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "requested_by_id" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "assigned_runner_id" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "lease_expires_at" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "started_at" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "finished_at" text;
ALTER TABLE "platform_operations" ADD COLUMN IF NOT EXISTS "cancelled_at" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "repository_key" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "runner_id" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "workspace_path" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "branch" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "commit_sha" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "claim_state" text DEFAULT 'active';
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "lease_expires_at" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "platform_repository_claims" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "subject_id" text;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "priority" real DEFAULT 0;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "estimated_credits" real;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "priority_overrides" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "priority_snapshots" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "priority_snapshots" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "priority_snapshots" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "priority_snapshots" ADD COLUMN IF NOT EXISTS "snapshot_json" text;
ALTER TABLE "priority_snapshots" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "priority_snapshots" ADD COLUMN IF NOT EXISTS "generated_at" text;
ALTER TABLE "priority_snapshots" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "priority_snapshots" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "namespace" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "operation" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "execution_class" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "allowed_targets_json" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "default_dispatch_mode" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "approval_policy_json" text DEFAULT '{}';
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "resource_scope_json" text DEFAULT '{}';
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "enabled" integer DEFAULT 1;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_capability_grants" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "mode" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "project_api_base_url" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "execution_owner" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "runner_registration_state" text DEFAULT 'pending';
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "runner_key_prefix" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "runner_key_hash" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "runner_registered_at" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "runner_last_seen_at" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_connections" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "deployment_kind" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "source_ref" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "release_tag" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "commit_sha" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "triggered_by_type" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "triggered_by_id" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "started_at" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "finished_at" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_deployments" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "deployment_profile" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "base_url" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "cloudflare_account_id" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "pages_project_name" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "worker_name" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "r2_bucket_name" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "d1_database_name" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "queue_name" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "railway_project_name" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_environments" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "hosting_kind" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "registration" text DEFAULT 'none';
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "market_base_url" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "source_repo_owner" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "source_repo_name" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "source_repo_url" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "source_repo_workflow_path" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_hosting" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "resource_kind" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "logical_name" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "locator" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_infrastructure_resources" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_summary_snapshots" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "project_summary_snapshots" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "project_summary_snapshots" ADD COLUMN IF NOT EXISTS "summary_json" text;
ALTER TABLE "project_summary_snapshots" ADD COLUMN IF NOT EXISTS "generated_at" text;
ALTER TABLE "project_summary_snapshots" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_summary_snapshots" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "hub_id" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "source_kind" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "source_ref" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "source_version" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "plan_json" text DEFAULT '{}';
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'planned';
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "requires_decision" integer DEFAULT 0;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "decision_id" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "created_by" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_update_plans" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "started_at" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "ended_at" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "summary_json" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "project_workday_summaries" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "job_id" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "host_kind" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "host_id" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "purpose" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "encrypted_payload_json" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "consumed_at" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "created_by_id" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "provider_credential_sessions" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "remote_job_events" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "remote_job_events" ADD COLUMN IF NOT EXISTS "job_id" text;
ALTER TABLE "remote_job_events" ADD COLUMN IF NOT EXISTS "seq" integer;
ALTER TABLE "remote_job_events" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "remote_job_events" ADD COLUMN IF NOT EXISTS "data_json" text;
ALTER TABLE "remote_job_events" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "namespace" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "operation" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "preferred_mode" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "selected_target" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "capability_json" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "input_json" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "output_json" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "error_json" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "requested_by_type" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "requested_by_id" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "assigned_runner_id" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "started_at" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "finished_at" text;
ALTER TABLE "remote_jobs" ADD COLUMN IF NOT EXISTS "cancelled_at" text;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "body_json" text;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "rendered_ref" text;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "sent_at" text;
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "repository_id" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "runner_id" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "runner_service_name" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "volume_identity" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "last_seen_commit" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "last_task_at" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "claim_state" text DEFAULT 'active';
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "repository_claims" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "ownership" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "account_label" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "organization_or_owner" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "default_visibility" text DEFAULT 'private';
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "software_repository_name_template" text DEFAULT '{hub}-site';
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "content_repository_name_template" text DEFAULT '{hub}-content';
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "branch_policy_json" text DEFAULT '{}';
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "workflow_policy_json" text DEFAULT '{}';
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "encrypted_payload_json" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "allowed_project_kinds_json" text DEFAULT '["knowledge_hub"]';
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "created_by_id" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "updated_by_id" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "repository_hosts" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "role_permissions" ADD COLUMN IF NOT EXISTS "role_id" text;
ALTER TABLE "role_permissions" ADD COLUMN IF NOT EXISTS "permission_id" text;
ALTER TABLE "role_permissions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "key" text;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "runner_id" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "runner_service_name" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "action" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "runner_scale_decisions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "runtime_envelopes" ADD COLUMN IF NOT EXISTS "id" integer;
ALTER TABLE "runtime_envelopes" ADD COLUMN IF NOT EXISTS "record_type" text;
ALTER TABLE "runtime_envelopes" ADD COLUMN IF NOT EXISTS "payload_json" text;
ALTER TABLE "runtime_envelopes" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "id" integer;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "record_type" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "record_key" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "lookup_key" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "secondary_key" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "status" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "payload_json" text;
ALTER TABLE "runtime_records" ADD COLUMN IF NOT EXISTS "meta_json" text;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "pool_name" text;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "desired_workers" integer;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "observed_queue_depth" integer DEFAULT 0;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "observed_active_leases" integer DEFAULT 0;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "scale_decisions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "seed_name" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "seed_version" integer;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "environments_json" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "mode" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "actor_type" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "actor_id" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "manifest_hash" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "plan_json" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "result_json" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "error_json" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "seed_runs" ADD COLUMN IF NOT EXISTS "completed_at" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "service_id" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "secret_hash" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "roles_json" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "permissions_json" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "revoked_at" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "service_credentials" ADD COLUMN IF NOT EXISTS "last_used_at" text;
ALTER TABLE "subscribers" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "subscribers" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "task_credit_ledger" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "task_credit_ledger" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "task_credit_ledger" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "task_credit_ledger" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "task_credit_ledger" ADD COLUMN IF NOT EXISTS "phase" text;
ALTER TABLE "task_credit_ledger" ADD COLUMN IF NOT EXISTS "credits" real;
ALTER TABLE "task_credit_ledger" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "task_credit_ledger" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "task_signature" text;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "execution_profile_id" text DEFAULT 'standard-code-model';
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "sample_count" integer DEFAULT 0;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "completed_sample_count" integer DEFAULT 0;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "interrupted_sample_count" integer DEFAULT 0;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "input_tokens_p50" integer;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "input_tokens_p90" integer;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "output_tokens_p50" integer;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "output_tokens_p90" integer;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "quota_minutes_p50" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "quota_minutes_p90" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "files_changed_p50" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "files_changed_p90" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "credits_p50" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "credits_p90" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "credits_variance" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "confidence_score" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "outlier_count" integer DEFAULT 0;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "partial_credits" real;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "first_sample_at" text;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "last_sample_at" text;
ALTER TABLE "task_estimate_profiles" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimate_phase" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "task_signature" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "confidence" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimated_credits_p50" real;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimated_credits_p90" real;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "reserved_credits" real;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimated_input_tokens_p50" integer;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimated_input_tokens_p90" integer;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimated_output_tokens_p50" integer;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimated_output_tokens_p90" integer;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimated_quota_minutes_p50" real;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "estimated_quota_minutes_p90" real;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "features_json" text DEFAULT '{}';
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "task_estimates" ADD COLUMN IF NOT EXISTS "execution_profile_id" text DEFAULT 'standard-code-model';
ALTER TABLE "task_events" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "task_events" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "task_events" ADD COLUMN IF NOT EXISTS "seq" integer;
ALTER TABLE "task_events" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "task_events" ADD COLUMN IF NOT EXISTS "data_json" text;
ALTER TABLE "task_events" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "task_outputs" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "task_outputs" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "task_outputs" ADD COLUMN IF NOT EXISTS "output_json" text;
ALTER TABLE "task_outputs" ADD COLUMN IF NOT EXISTS "output_ref" text;
ALTER TABLE "task_outputs" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "task_id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "task_signature" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "capacity_provider_id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "execution_provider_id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "lane_id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "business_model" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "model_name" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "input_tokens" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "output_tokens" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "cached_input_tokens" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "quota_minutes" real;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "wall_minutes" real;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "files_opened" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "files_changed" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "diff_lines_added" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "diff_lines_removed" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "test_runs" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "retry_count" integer;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "actual_credits" real;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "actual_usd" real;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "credit_formula_version" text DEFAULT 'treeseed.actual-credits.v1';
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "actual_credit_source" text DEFAULT 'central_calculator';
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "native_usage_json" text DEFAULT '{}';
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "execution_profile_id" text DEFAULT 'standard-code-model';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "agent_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "type" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "payload_json" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "payload_hash" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "max_attempts" integer DEFAULT 3;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "claimed_by" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "lease_expires_at" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "available_at" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "last_error_code" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "last_error_message" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "graph_version" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "started_at" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "completed_at" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "key_prefix" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "key_hash" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "permissions_json" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "last_used_at" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "revoked_at" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "team_api_keys" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "kind" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "href" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "item_key" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "metadata_json" text DEFAULT '{}';
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "team_inbox_items" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "role_key" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "token_prefix" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "token_hash" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending';
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "invited_by_user_id" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "accepted_by_user_id" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "accepted_at" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "team_memberships" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "team_memberships" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "team_memberships" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "team_memberships" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "team_memberships" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "team_memberships" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "team_role_bindings" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "team_role_bindings" ADD COLUMN IF NOT EXISTS "team_membership_id" text;
ALTER TABLE "team_role_bindings" ADD COLUMN IF NOT EXISTS "role_id" text;
ALTER TABLE "team_role_bindings" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "bucket_name" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "manifest_key_template" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "preview_root_template" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "public_base_url" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "team_storage_locators" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "team_id" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "ownership" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "account_label" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "allowed_environments_json" text DEFAULT '[]';
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "encrypted_payload_json" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "created_by_id" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "updated_by_id" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "team_web_hosts" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "logo_url" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "profile_summary" text;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "provider_subject" text;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "email_verified" integer DEFAULT 0;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "profile_json" text;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "color_scheme" text DEFAULT 'fern';
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "theme_mode" text DEFAULT 'system';
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "user_role_bindings" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "user_role_bindings" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "user_role_bindings" ADD COLUMN IF NOT EXISTS "role_id" text;
ALTER TABLE "user_role_bindings" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "identity_id" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "better_auth_session_id" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "provider_subject" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "principal_json" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "csrf_token" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "ip_address" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "user_agent" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "authenticated_at" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "revoked_at" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "web_sessions" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "state" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "capacity_budget" integer DEFAULT 0;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "capacity_used" integer DEFAULT 0;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "graph_version" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "summary_json" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "started_at" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "ended_at" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "work_days" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "schedule_json" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "daily_task_credit_budget" integer DEFAULT 0;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "max_queued_tasks" integer DEFAULT 0;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "max_queued_credits" integer DEFAULT 0;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "autoscale_json" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "credit_weights_json" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "enabled" integer DEFAULT 1;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "start_cron" text DEFAULT '0 9 * * 1-5';
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "duration_minutes" integer DEFAULT 480;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "max_runners" integer DEFAULT 1;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "max_workers_per_runner" integer DEFAULT 4;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "daily_credit_budget" integer DEFAULT 0;
ALTER TABLE "work_policies" ADD COLUMN IF NOT EXISTS "closeout_grace_minutes" integer DEFAULT 15;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "manager_id" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'active';
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "heartbeat_at" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "expires_at" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "workday_manager_leases" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "type" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'pending';
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "work_day_id" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "requested_by" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "payload_json" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "workday_requests" ADD COLUMN IF NOT EXISTS "updated_at" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "project_id" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "environment" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "runner_id" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "runner_service_name" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "volume_identity" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'active';
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "max_local_workers" integer DEFAULT 4;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "active_local_workers" integer DEFAULT 0;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "available_capacity" integer DEFAULT 4;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "claimed_repository_ids_json" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "metadata_json" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "created_at" text;
ALTER TABLE "worker_runners" ADD COLUMN IF NOT EXISTS "updated_at" text;
-- End Treeseed Market schema adoption columns

-- Backfill verified account emails from existing active credential rows.
INSERT INTO user_email_addresses (
	id, user_id, email, normalized_email, status, is_primary, verification_requested_at, verified_at, created_at, updated_at
)
SELECT 'email_' || md5(user_id || ':' || LOWER(email)), user_id, email, LOWER(email), 'verified', 1, created_at, COALESCE(updated_at, created_at), created_at, updated_at
  FROM market_auth_credentials
 WHERE email IS NOT NULL
   AND email != ''
   AND status = 'active'
ON CONFLICT (normalized_email) DO NOTHING;

CREATE INDEX IF NOT EXISTS "idx_agent_pool_registrations_pool_heartbeat" ON "agent_pool_registrations" USING btree ("pool_id","heartbeat_at");
CREATE INDEX IF NOT EXISTS "idx_agent_pool_scale_decisions_pool_created" ON "agent_pool_scale_decisions" USING btree ("pool_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_pools_project_environment_name" ON "agent_pools" USING btree ("project_id","environment","name");
CREATE INDEX IF NOT EXISTS "idx_api_tokens_user_id" ON "api_tokens" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_api_tokens_prefix" ON "api_tokens" USING btree ("token_prefix");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_team_state" ON "approval_requests" USING btree ("team_id","state","created_at");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_project_workday" ON "approval_requests" USING btree ("project_id","work_day_id","state","created_at");
CREATE INDEX IF NOT EXISTS "idx_audit_events_target" ON "audit_events" USING btree ("target_type","target_id");
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_user_id" ON "auth_sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_better_auth_account_userId" ON "better_auth_account" USING btree ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_better_auth_account_provider_account" ON "better_auth_account" USING btree ("providerId","accountId");
CREATE INDEX IF NOT EXISTS "idx_better_auth_session_token" ON "better_auth_session" USING btree ("token");
CREATE INDEX IF NOT EXISTS "idx_better_auth_session_userId" ON "better_auth_session" USING btree ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_better_auth_user_username" ON "better_auth_user" USING btree ("username");
CREATE INDEX IF NOT EXISTS "idx_better_auth_verification_identifier" ON "better_auth_verification" USING btree ("identifier");
CREATE INDEX IF NOT EXISTS "idx_capacity_grants_team_project" ON "capacity_grants" USING btree ("team_id","project_id","state");
CREATE INDEX IF NOT EXISTS "idx_capacity_grants_provider_lane" ON "capacity_grants" USING btree ("capacity_provider_id","lane_id","state");
CREATE INDEX IF NOT EXISTS "idx_capacity_ledger_project_workday_created" ON "capacity_ledger_entries" USING btree ("project_id","work_day_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_capacity_provider_api_keys_provider_status" ON "capacity_provider_api_keys" USING btree ("capacity_provider_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_capacity_provider_api_keys_prefix" ON "capacity_provider_api_keys" USING btree ("key_prefix");
CREATE INDEX IF NOT EXISTS "idx_capacity_provider_deployments_provider_created" ON "capacity_provider_deployments" USING btree ("capacity_provider_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_capacity_provider_hosts_unique" ON "capacity_provider_hosts" USING btree ("capacity_provider_id","host_id","role");
CREATE INDEX IF NOT EXISTS "idx_capacity_provider_lanes_provider" ON "capacity_provider_lanes" USING btree ("capacity_provider_id","business_model","scarcity_level");
CREATE INDEX IF NOT EXISTS "idx_capacity_provider_registrations_provider_seen" ON "capacity_provider_registrations" USING btree ("capacity_provider_id","last_seen_at");
CREATE INDEX IF NOT EXISTS "idx_capacity_providers_team_status" ON "capacity_providers" USING btree ("team_id","status","provider");
CREATE INDEX IF NOT EXISTS "idx_capacity_reservations_project_workday_state" ON "capacity_reservations" USING btree ("project_id","work_day_id","state","created_at");
CREATE INDEX IF NOT EXISTS "idx_capacity_reservations_provider_state" ON "capacity_reservations" USING btree ("capacity_provider_id","lane_id","state");
CREATE INDEX IF NOT EXISTS "idx_capacity_reservations_execution_provider_state" ON "capacity_reservations" USING btree ("execution_provider_id","state","created_at");
CREATE INDEX IF NOT EXISTS "idx_capacity_routing_decisions_project_workday" ON "capacity_routing_decisions" USING btree ("project_id","work_day_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_catalog_artifact_versions_item_version" ON "catalog_artifact_versions" USING btree ("item_id","version");
CREATE INDEX IF NOT EXISTS "idx_catalog_artifact_versions_team_kind" ON "catalog_artifact_versions" USING btree ("team_id","kind","published_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_catalog_item_collaborators_subject_role" ON "catalog_item_collaborators" USING btree ("item_id","subject_type","subject_id","role");
CREATE INDEX IF NOT EXISTS "idx_catalog_items_team_kind" ON "catalog_items" USING btree ("team_id","kind","updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_catalog_items_team_kind_slug" ON "catalog_items" USING btree ("team_id","kind","slug");
CREATE INDEX IF NOT EXISTS "idx_catalog_items_visibility_listing" ON "catalog_items" USING btree ("visibility","listing_enabled","updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_credit_conversion_profiles_profile_key" ON "credit_conversion_profiles" USING btree ("task_signature","execution_profile_id","execution_provider_kind","native_unit");
CREATE INDEX IF NOT EXISTS "idx_credit_conversion_profiles_kind_unit" ON "credit_conversion_profiles" USING btree ("execution_provider_kind","native_unit","updated_at");
CREATE INDEX IF NOT EXISTS "idx_cursor_state_updated" ON "cursor_state" USING btree ("updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_entitlements_project" ON "entitlements" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "idx_execution_provider_native_limits_provider_scope" ON "execution_provider_native_limits" USING btree ("execution_provider_id","scope","native_unit");
CREATE INDEX IF NOT EXISTS "idx_execution_provider_observations_provider_observed" ON "execution_provider_observations" USING btree ("execution_provider_id","observed_at");
CREATE INDEX IF NOT EXISTS "idx_execution_providers_team_status" ON "execution_providers" USING btree ("team_id","status","kind");
CREATE INDEX IF NOT EXISTS "idx_execution_providers_capacity_provider" ON "execution_providers" USING btree ("capacity_provider_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_hub_launch_events_launch_seq" ON "hub_launch_events" USING btree ("launch_id","seq");
CREATE INDEX IF NOT EXISTS "idx_hub_launches_hub_created" ON "hub_launches" USING btree ("hub_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_hub_repositories_hub_role" ON "hub_repositories" USING btree ("hub_id","role");
CREATE INDEX IF NOT EXISTS "idx_hub_workspace_links_hub" ON "hub_workspace_links" USING btree ("hub_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_packs_team_id" ON "knowledge_packs" USING btree ("team_id");
CREATE INDEX IF NOT EXISTS "idx_lease_state_status_expires" ON "lease_state" USING btree ("status","lease_expires_at");
CREATE INDEX IF NOT EXISTS "idx_lease_state_claimed_by" ON "lease_state" USING btree ("claimed_by","updated_at");
CREATE INDEX IF NOT EXISTS "idx_message_queue_claimable" ON "message_queue" USING btree ("status","available_at","priority");
CREATE INDEX IF NOT EXISTS "idx_message_queue_related" ON "message_queue" USING btree ("related_model","related_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_native_usage_observations_profile" ON "native_usage_observations" USING btree ("project_id","task_signature","execution_profile_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_native_usage_observations_provider" ON "native_usage_observations" USING btree ("execution_provider_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_platform_operation_events_seq" ON "platform_operation_events" USING btree ("operation_id","seq");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_platform_operations_idempotency" ON "platform_operations" USING btree ("namespace","operation","idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_platform_operations_runnable" ON "platform_operations" USING btree ("status","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_platform_repository_claims_active" ON "platform_repository_claims" USING btree ("repository_key","runner_id");
CREATE INDEX IF NOT EXISTS "idx_platform_repository_claims_runner" ON "platform_repository_claims" USING btree ("runner_id","claim_state");
CREATE INDEX IF NOT EXISTS "idx_priority_overrides_project_priority" ON "priority_overrides" USING btree ("project_id","priority","updated_at");
CREATE INDEX IF NOT EXISTS "idx_priority_snapshots_project_generated" ON "priority_snapshots" USING btree ("project_id","generated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_capability_grants_project_operation" ON "project_capability_grants" USING btree ("project_id","namespace","operation");
CREATE INDEX IF NOT EXISTS "idx_project_deployment_events_deployment_sequence" ON "project_deployment_events" USING btree ("deployment_id","sequence");
CREATE INDEX IF NOT EXISTS "idx_project_deployment_events_project_created" ON "project_deployment_events" USING btree ("project_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_project_deployment_events_operation" ON "project_deployment_events" USING btree ("operation_id");
CREATE INDEX IF NOT EXISTS "idx_project_deployments_project_created" ON "project_deployments" USING btree ("project_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_project_deployments_project_environment" ON "project_deployments" USING btree ("project_id","environment","created_at");
CREATE INDEX IF NOT EXISTS "idx_project_deployments_project_status" ON "project_deployments" USING btree ("project_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "idx_project_deployments_operation" ON "project_deployments" USING btree ("platform_operation_id");
CREATE INDEX IF NOT EXISTS "idx_project_deployments_team_created" ON "project_deployments" USING btree ("team_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_deployments_idempotency" ON "project_deployments" USING btree ("project_id","idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_environments_project_environment" ON "project_environments" USING btree ("project_id","environment");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_infrastructure_resource_unique" ON "project_infrastructure_resources" USING btree ("project_id","environment","provider","resource_kind","logical_name");
CREATE INDEX IF NOT EXISTS "idx_project_summary_snapshots_team_generated" ON "project_summary_snapshots" USING btree ("team_id","generated_at");
CREATE INDEX IF NOT EXISTS "idx_project_update_plans_hub" ON "project_update_plans" USING btree ("hub_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_project_workday_summaries_project_environment_created" ON "project_workday_summaries" USING btree ("project_id","environment","created_at");
CREATE INDEX IF NOT EXISTS "idx_projects_team_id" ON "projects" USING btree ("team_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_team_slug" ON "projects" USING btree ("team_id","slug");
CREATE INDEX IF NOT EXISTS "idx_provider_credential_sessions_team_host" ON "provider_credential_sessions" USING btree ("team_id","host_kind","host_id","status");
CREATE INDEX IF NOT EXISTS "idx_provider_credential_sessions_job" ON "provider_credential_sessions" USING btree ("job_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_remote_job_events_job_seq" ON "remote_job_events" USING btree ("job_id","seq");
CREATE INDEX IF NOT EXISTS "idx_remote_jobs_project_status" ON "remote_jobs" USING btree ("project_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_remote_jobs_project_idempotency" ON "remote_jobs" USING btree ("project_id","idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_repository_claims_runner_repo" ON "repository_claims" USING btree ("project_id","repository_id","runner_id");
CREATE INDEX IF NOT EXISTS "idx_repository_claims_repo_state" ON "repository_claims" USING btree ("project_id","repository_id","claim_state","updated_at");
CREATE INDEX IF NOT EXISTS "idx_repository_hosts_team_provider" ON "repository_hosts" USING btree ("team_id","provider","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_repository_hosts_team_provider_name" ON "repository_hosts" USING btree ("team_id","provider","name");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_repository_hosts_platform_provider_name" ON "repository_hosts" USING btree ("provider","name");
CREATE INDEX IF NOT EXISTS "idx_runner_scale_decisions_project_workday" ON "runner_scale_decisions" USING btree ("project_id","environment","work_day_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_runtime_records_type_lookup_updated" ON "runtime_records" USING btree ("record_type","lookup_key","updated_at");
CREATE INDEX IF NOT EXISTS "idx_runtime_records_type_status_updated" ON "runtime_records" USING btree ("record_type","status","updated_at");
CREATE INDEX IF NOT EXISTS "idx_scale_decisions_project_environment_pool_created" ON "scale_decisions" USING btree ("project_id","environment","pool_name","created_at");
CREATE INDEX IF NOT EXISTS "idx_seed_runs_seed_created" ON "seed_runs" USING btree ("seed_name","created_at");
CREATE INDEX IF NOT EXISTS "idx_seed_runs_state_created" ON "seed_runs" USING btree ("state","created_at");
CREATE INDEX IF NOT EXISTS "idx_task_credit_ledger_work_day_created" ON "task_credit_ledger" USING btree ("work_day_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_task_estimates_project_signature" ON "task_estimates" USING btree ("project_id","task_signature","created_at");
CREATE INDEX IF NOT EXISTS "idx_task_estimates_project_signature_profile" ON "task_estimates" USING btree ("project_id","task_signature","execution_profile_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_events_seq" ON "task_events" USING btree ("task_id","seq");
CREATE INDEX IF NOT EXISTS "idx_task_usage_actuals_project_signature" ON "task_usage_actuals" USING btree ("project_id","task_signature","created_at");
CREATE INDEX IF NOT EXISTS "idx_task_usage_actuals_project_signature_profile" ON "task_usage_actuals" USING btree ("project_id","task_signature","execution_profile_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_task_usage_actuals_execution_provider" ON "task_usage_actuals" USING btree ("execution_provider_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_tasks_runnable" ON "tasks" USING btree ("state","priority","available_at");
CREATE INDEX IF NOT EXISTS "idx_tasks_work_day_agent" ON "tasks" USING btree ("work_day_id","agent_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_team_api_keys_prefix" ON "team_api_keys" USING btree ("key_prefix");
CREATE INDEX IF NOT EXISTS "idx_team_inbox_items_team_created" ON "team_inbox_items" USING btree ("team_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_team_invites_team_status" ON "team_invites" USING btree ("team_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_team_invites_token_prefix" ON "team_invites" USING btree ("token_prefix");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_team_memberships_team_user" ON "team_memberships" USING btree ("team_id","user_id");
CREATE INDEX IF NOT EXISTS "idx_team_web_hosts_team_provider" ON "team_web_hosts" USING btree ("team_id","provider","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_team_web_hosts_team_provider_name" ON "team_web_hosts" USING btree ("team_id","provider","name");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_teams_name" ON "teams" USING btree ("name");
CREATE INDEX IF NOT EXISTS "idx_user_email_addresses_user" ON "user_email_addresses" USING btree ("user_id","status","is_primary");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_email_addresses_normalized" ON "user_email_addresses" USING btree ("normalized_email");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_identities_provider_subject" ON "user_identities" USING btree ("provider","provider_subject");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_role_bindings_user_role" ON "user_role_bindings" USING btree ("user_id","role_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_username" ON "users" USING btree ("username");
CREATE INDEX IF NOT EXISTS "idx_web_sessions_user_id" ON "web_sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_workday_manager_leases_active" ON "workday_manager_leases" USING btree ("project_id","environment","state","heartbeat_at");
CREATE INDEX IF NOT EXISTS "idx_workday_requests_project_environment_state" ON "workday_requests" USING btree ("project_id","environment","state","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_worker_runners_identity" ON "worker_runners" USING btree ("project_id","environment","runner_id");
CREATE INDEX IF NOT EXISTS "idx_worker_runners_state_capacity" ON "worker_runners" USING btree ("project_id","environment","state","available_capacity");
