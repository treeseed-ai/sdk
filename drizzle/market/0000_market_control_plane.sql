CREATE TABLE "agent_capacity_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scope_hash" text NOT NULL,
	"allocation_set_id" text,
	"work_day_id" text,
	"expected_credits" real DEFAULT 0 NOT NULL,
	"high_credits" real DEFAULT 0 NOT NULL,
	"work_units_json" text DEFAULT '[]' NOT NULL,
	"capability_needs_json" text DEFAULT '[]' NOT NULL,
	"environment_needs_json" text DEFAULT '[]' NOT NULL,
	"reserves_json" text DEFAULT '{}' NOT NULL,
	"blockers_json" text DEFAULT '[]' NOT NULL,
	"priority_rationale" text,
	"review_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"accepted_at" text,
	"scheduled_at" text,
	"superseded_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_agent_capacity_plans_status" CHECK ("agent_capacity_plans"."status" IN ('draft','accepted','revision_requested','deferred','scheduled','active','completed','superseded')),
	CONSTRAINT "chk_agent_capacity_plans_credits" CHECK ("agent_capacity_plans"."expected_credits" >= 0 AND "agent_capacity_plans"."high_credits" >= "agent_capacity_plans"."expected_credits")
);

CREATE TABLE "agent_fallback_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text,
	"mode" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"output_json" text DEFAULT '{}' NOT NULL,
	"provenance_json" text DEFAULT '{}' NOT NULL,
	"quota_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "agent_mode_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"provider_assignment_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"execution_provider_id" text,
	"project_agent_class_id" text NOT NULL,
	"agent_id" text,
	"handler_id" text,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"selected_input_json" text DEFAULT '{}' NOT NULL,
	"capacity_envelope_json" text DEFAULT '{}' NOT NULL,
	"outputs_json" text DEFAULT '{}' NOT NULL,
	"trace_refs_json" text DEFAULT '{}' NOT NULL,
	"usage_actual_json" text DEFAULT '{}' NOT NULL,
	"validation_json" text DEFAULT '{}' NOT NULL,
	"fallback_reason" text,
	"started_at" text,
	"completed_at" text,
	"failed_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_agent_mode_runs_mode" CHECK ("agent_mode_runs"."mode" IN ('planning', 'acting')),
	CONSTRAINT "chk_agent_mode_runs_status" CHECK ("agent_mode_runs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

CREATE TABLE "agent_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"agent_slug" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "api_tokens" (
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

CREATE TABLE "approval_requests" (
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

CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"event_type" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"data_json" text,
	"created_at" text NOT NULL
);

CREATE TABLE "auth_provider_states" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier" text,
	"nonce" text,
	"callback_url" text NOT NULL,
	"return_to" text NOT NULL,
	"link_user_id" text,
	"purpose" text DEFAULT 'sign-in' NOT NULL,
	"action" text,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "auth_provider_states_state_hash_unique" UNIQUE("state_hash")
);

CREATE TABLE "auth_reauthentication_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"action" text NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_at" text NOT NULL
);

CREATE TABLE "auth_sessions" (
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

CREATE TABLE "better_auth_account" (
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

CREATE TABLE "better_auth_session" (
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

CREATE TABLE "better_auth_user" (
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

CREATE TABLE "better_auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" bigint NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);

CREATE TABLE "capacity_admission_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"period_key" text NOT NULL,
	"hard_limit" real NOT NULL,
	"committed_amount" real DEFAULT 0 NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_admission_counter_hard_limit" CHECK ("capacity_admission_counters"."hard_limit" >= 0),
	CONSTRAINT "chk_capacity_admission_counter_committed_amount" CHECK ("capacity_admission_counters"."committed_amount" >= 0 AND "capacity_admission_counters"."committed_amount" <= "capacity_admission_counters"."hard_limit")
);

CREATE TABLE "capacity_allocation_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" text NOT NULL,
	"effective_until" text,
	"reserve_policy_json" text DEFAULT '{}' NOT NULL,
	"slices_json" text DEFAULT '[]' NOT NULL,
	"borrowing_rules_json" text DEFAULT '[]' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_by_id" text,
	"activated_at" text,
	"superseded_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_allocation_sets_version" CHECK ("capacity_allocation_sets"."version" >= 1),
	CONSTRAINT "chk_capacity_allocation_sets_status" CHECK ("capacity_allocation_sets"."status" IN ('draft', 'validated', 'active', 'superseded', 'archived')),
	CONSTRAINT "chk_capacity_allocation_sets_effective_interval" CHECK ("capacity_allocation_sets"."effective_until" IS NULL OR "capacity_allocation_sets"."effective_until" > "capacity_allocation_sets"."effective_from")
);

CREATE TABLE "capacity_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"capacity_provider_id" text,
	"membership_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"request_id" text,
	"idempotency_key" text,
	"before_fingerprint" text,
	"after_fingerprint" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "capacity_execution_providers" (
	"id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"display_name" text NOT NULL,
	"adapter" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"native_unit" text NOT NULL,
	"quota_visibility" text DEFAULT 'opaque' NOT NULL,
	"max_concurrent_runners" integer NOT NULL,
	"native_limits_json" text DEFAULT '[]' NOT NULL,
	"latest_observation_json" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "capacity_execution_providers_capacity_provider_id_id_pk" PRIMARY KEY("capacity_provider_id","id"),
	CONSTRAINT "chk_capacity_execution_providers_status" CHECK ("capacity_execution_providers"."status" IN ('active', 'degraded', 'unavailable', 'revoked')),
	CONSTRAINT "chk_capacity_execution_providers_concurrency" CHECK ("capacity_execution_providers"."max_concurrent_runners" >= 1)
);

CREATE TABLE "capacity_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"execution_provider_ids_json" text DEFAULT '[]' NOT NULL,
	"lane_ids_json" text DEFAULT '[]' NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"allowed_modes_json" text DEFAULT '[]' NOT NULL,
	"daily_credit_limit" real,
	"monthly_credit_limit" real,
	"max_concurrent_assignments" integer,
	"unmetered" integer DEFAULT 0 NOT NULL,
	"expires_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_grants_status" CHECK ("capacity_grants"."status" IN ('planned', 'active', 'paused', 'revoked', 'expired')),
	CONSTRAINT "chk_capacity_grants_unmetered" CHECK ("capacity_grants"."unmetered" IN (0, 1)),
	CONSTRAINT "chk_capacity_grants_daily_limit" CHECK ("capacity_grants"."daily_credit_limit" IS NULL OR "capacity_grants"."daily_credit_limit" >= 0),
	CONSTRAINT "chk_capacity_grants_monthly_limit" CHECK ("capacity_grants"."monthly_credit_limit" IS NULL OR "capacity_grants"."monthly_credit_limit" >= 0),
	CONSTRAINT "chk_capacity_grants_concurrency" CHECK ("capacity_grants"."max_concurrent_assignments" IS NULL OR "capacity_grants"."max_concurrent_assignments" >= 0)
);

CREATE TABLE "capacity_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_key" text NOT NULL,
	"membership_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"reservation_id" text,
	"assignment_id" text,
	"mode_run_id" text,
	"mode" text,
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
	"created_at" text NOT NULL,
	CONSTRAINT "chk_capacity_ledger_credits" CHECK ("capacity_ledger_entries"."credits" >= 0)
);

CREATE TABLE "capacity_operation_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"response_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "capacity_provider_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"issued_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"last_used_at" text,
	"expired_at" text,
	"revoked_at" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_provider_access_tokens_status" CHECK ("capacity_provider_access_tokens"."status" IN ('active', 'revoked', 'expired'))
);

CREATE TABLE "capacity_provider_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"provider_session_id" text,
	"execution_provider_id" text,
	"lane_id" text,
	"allocation_set_id" text,
	"project_agent_class_id" text NOT NULL,
	"reservation_id" text,
	"work_day_id" text,
	"task_id" text,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_state" text DEFAULT 'unleased' NOT NULL,
	"lease_expires_at" text,
	"lease_token" text,
	"state_version" integer DEFAULT 1 NOT NULL,
	"lease_renewed_at" text,
	"runner_id" text,
	"agent_id" text,
	"handler_id" text,
	"capacity_envelope_json" text DEFAULT '{}' NOT NULL,
	"decision_input_json" text DEFAULT '{}' NOT NULL,
	"workspace_context_json" text DEFAULT '{}' NOT NULL,
	"allowed_outputs_json" text DEFAULT '{}' NOT NULL,
	"explanation_json" text DEFAULT '{}' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"assigned_at" text,
	"claimed_at" text,
	"completed_at" text,
	"returned_at" text,
	"failed_at" text,
	"lifecycle_reason" text,
	"lifecycle_code" text,
	"lifecycle_output_json" text DEFAULT '{}' NOT NULL,
	"synthesized_from" text,
	"synthesis_key" text,
	"decision_id" text,
	"proposal_id" text,
	"fallback_output_id" text,
	"treedx_proxy_handle_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_provider_assignments_state_version" CHECK ("capacity_provider_assignments"."state_version" >= 1),
	CONSTRAINT "chk_capacity_provider_assignments_mode" CHECK ("capacity_provider_assignments"."mode" IN ('planning', 'acting')),
	CONSTRAINT "chk_capacity_provider_assignments_status" CHECK ("capacity_provider_assignments"."status" IN ('pending', 'leased', 'running', 'completed', 'failed', 'returned', 'expired', 'cancelled')),
	CONSTRAINT "chk_capacity_provider_assignments_lease_state" CHECK ("capacity_provider_assignments"."lease_state" IN ('unleased', 'leased', 'released', 'expired'))
);

CREATE TABLE "capacity_provider_credential_issuance_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"generation" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"issued_credential_id" text,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_provider_credential_authorizations_generation" CHECK ("capacity_provider_credential_issuance_authorizations"."generation" >= 1),
	CONSTRAINT "chk_capacity_provider_credential_authorizations_status" CHECK ("capacity_provider_credential_issuance_authorizations"."status" IN ('pending', 'issued', 'cancelled'))
);

CREATE TABLE "capacity_provider_identity_rotations" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"from_identity_version" integer NOT NULL,
	"to_identity_version" integer NOT NULL,
	"old_fingerprint" text NOT NULL,
	"new_fingerprint" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_capacity_provider_identity_rotations_versions" CHECK ("capacity_provider_identity_rotations"."from_identity_version" >= 1 AND "capacity_provider_identity_rotations"."to_identity_version" = "capacity_provider_identity_rotations"."from_identity_version" + 1)
);

CREATE TABLE "capacity_provider_lanes" (
	"id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"execution_provider_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"max_concurrent_runners" integer NOT NULL,
	"native_limits_json" text DEFAULT '[]' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "capacity_provider_lanes_capacity_provider_id_id_pk" PRIMARY KEY("capacity_provider_id","id"),
	CONSTRAINT "chk_capacity_provider_lanes_status" CHECK ("capacity_provider_lanes"."status" IN ('active', 'paused', 'degraded', 'revoked')),
	CONSTRAINT "chk_capacity_provider_lanes_concurrency" CHECK ("capacity_provider_lanes"."max_concurrent_runners" >= 1)
);

CREATE TABLE "capacity_provider_proof_nonces" (
	"provider_fingerprint" text NOT NULL,
	"jti" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "capacity_provider_proof_nonces_provider_fingerprint_jti_pk" PRIMARY KEY("provider_fingerprint","jti")
);

CREATE TABLE "capacity_provider_registration_rate_limits" (
	"dimension" text NOT NULL,
	"bucket_key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "capacity_provider_registration_rate_limits_dimension_bucket_key_pk" PRIMARY KEY("dimension","bucket_key"),
	CONSTRAINT "chk_capacity_provider_registration_rate_limits_count" CHECK ("capacity_provider_registration_rate_limits"."count" >= 0)
);

CREATE TABLE "capacity_provider_registration_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"provider_fingerprint" text NOT NULL,
	"registration_key_generation" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"capability_summary_json" text DEFAULT '[]' NOT NULL,
	"supply_offer_json" text DEFAULT '{}' NOT NULL,
	"proof_jti" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"expires_at" text NOT NULL,
	"reviewed_at" text,
	"reviewed_by_id" text,
	"rejection_reason" text,
	"membership_id" text,
	"transition_action" text,
	"transition_idempotency_key" text,
	"transition_request_digest" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_provider_registration_requests_generation" CHECK ("capacity_provider_registration_requests"."registration_key_generation" >= 1),
	CONSTRAINT "chk_capacity_provider_registration_requests_status" CHECK ("capacity_provider_registration_requests"."status" IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'))
);

CREATE TABLE "capacity_provider_team_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"issuance_authorization_id" text NOT NULL,
	"issuance_generation" integer NOT NULL,
	"issue_idempotency_key" text NOT NULL,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" text,
	"rotated_from_credential_id" text,
	"expires_at" text,
	"revealed_at" text,
	"revoked_at" text,
	"revoke_idempotency_key" text,
	"revoke_request_digest" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_provider_team_credentials_status" CHECK ("capacity_provider_team_credentials"."status" IN ('active', 'rotating', 'revoked'))
);

CREATE TABLE "capacity_provider_team_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"team_alias" text,
	"approved_at" text NOT NULL,
	"approved_by_id" text NOT NULL,
	"suspended_at" text,
	"revoked_at" text,
	"revoked_by_id" text,
	"status_idempotency_key" text,
	"status_request_digest" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_provider_team_memberships_status" CHECK ("capacity_provider_team_memberships"."status" IN ('approved', 'suspended', 'revoked'))
);

CREATE TABLE "capacity_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"public_jwk_json" text NOT NULL,
	"display_name" text NOT NULL,
	"identity_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"rotated_at" text,
	"revoked_at" text,
	CONSTRAINT "chk_capacity_providers_identity_version" CHECK ("capacity_providers"."identity_version" >= 1),
	CONSTRAINT "chk_capacity_providers_status" CHECK ("capacity_providers"."status" IN ('active', 'rotating', 'revoked'))
);

CREATE TABLE "capacity_reservation_counter_claims" (
	"reservation_id" text NOT NULL,
	"counter_id" text NOT NULL,
	"admission_token" text NOT NULL,
	"reserved_amount" real NOT NULL,
	"released_amount" real DEFAULT 0 NOT NULL,
	"release_policy" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_reservation_claim_reserved" CHECK ("capacity_reservation_counter_claims"."reserved_amount" >= 0),
	CONSTRAINT "chk_capacity_reservation_claim_released" CHECK ("capacity_reservation_counter_claims"."released_amount" >= 0 AND "capacity_reservation_counter_claims"."released_amount" <= "capacity_reservation_counter_claims"."reserved_amount")
);

CREATE TABLE "capacity_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"admission_token" text NOT NULL,
	"membership_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"execution_provider_id" text,
	"lane_id" text,
	"allocation_set_id" text NOT NULL,
	"allocation_version" integer NOT NULL,
	"allocation_slice_ids_json" text DEFAULT '[]' NOT NULL,
	"policy_snapshot_json" text DEFAULT '{}' NOT NULL,
	"project_agent_class_id" text NOT NULL,
	"assignment_id" text,
	"mode" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_day_id" text,
	"task_id" text,
	"state" text DEFAULT 'reserved' NOT NULL,
	"usage_report_token" text,
	"settlement_token" text,
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
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_reservations_allocation_version" CHECK ("capacity_reservations"."allocation_version" >= 1),
	CONSTRAINT "chk_capacity_reservations_mode" CHECK ("capacity_reservations"."mode" IN ('planning', 'acting')),
	CONSTRAINT "chk_capacity_reservations_state" CHECK ("capacity_reservations"."state" IN ('reserved', 'consuming', 'consumed', 'released', 'expired', 'failed', 'overran_pending_approval', 'continuation_required')),
	CONSTRAINT "chk_capacity_reservations_reserved_credits" CHECK ("capacity_reservations"."reserved_credits" > 0),
	CONSTRAINT "chk_capacity_reservations_consumed_credits" CHECK ("capacity_reservations"."consumed_credits" >= 0)
);

CREATE TABLE "capacity_usage_actuals" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"task_id" text,
	"work_day_id" text,
	"project_id" text NOT NULL,
	"task_signature" text NOT NULL,
	"assignment_id" text,
	"assignment_attempt" integer NOT NULL,
	"usage_dimension" text NOT NULL,
	"accounting_mode" text NOT NULL,
	"mode_run_id" text,
	"mode" text,
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
	"execution_profile_id" text DEFAULT 'standard-code-model' NOT NULL,
	CONSTRAINT "chk_capacity_usage_actuals_credits" CHECK ("capacity_usage_actuals"."actual_credits" >= 0),
	CONSTRAINT "chk_capacity_usage_actuals_assignment_attempt" CHECK ("capacity_usage_actuals"."assignment_attempt" >= 0),
	CONSTRAINT "chk_capacity_usage_actuals_accounting_mode" CHECK ("capacity_usage_actuals"."accounting_mode" IN ('informational', 'incremental', 'aggregate'))
);

CREATE TABLE "capacity_workday_demands" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"workday_run_id" text NOT NULL,
	"workday_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"mode" text NOT NULL,
	"project_agent_class_id" text NOT NULL,
	"agent_id" text,
	"handler_id" text NOT NULL,
	"activity_type" text NOT NULL,
	"decision_id" text,
	"capacity_plan_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"requested_credits" real NOT NULL,
	"idempotency_key" text NOT NULL,
	"claim_token" text,
	"assignment_id" text,
	"payload_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"available_at" text NOT NULL,
	"claimed_at" text,
	"admitted_at" text,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_workday_demands_mode" CHECK ("capacity_workday_demands"."mode" IN ('planning','acting')),
	CONSTRAINT "chk_capacity_workday_demands_status" CHECK ("capacity_workday_demands"."status" IN ('pending','claimed','admitted','completed','blocked','cancelled','superseded')),
	CONSTRAINT "chk_capacity_workday_demands_source" CHECK ("capacity_workday_demands"."source_type" IN ('objective','question','proposal','decision-review','knowledge-gap','release-readiness','idle-intent','planning-input','capacity-plan','assignment-completion','assignment-blockage','workday-summary','handoff','research-workflow')),
	CONSTRAINT "chk_capacity_workday_demands_credits" CHECK ("capacity_workday_demands"."requested_credits" > 0)
);

CREATE TABLE "capacity_workday_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"workday_id" text,
	"assignment_id" text,
	"mode_run_id" text,
	"event_index" integer NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"title" text,
	"message" text,
	"parameters_json" text DEFAULT '{}' NOT NULL,
	"context_json" text DEFAULT '{}' NOT NULL,
	"refs_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_capacity_workday_events_index" CHECK ("capacity_workday_events"."event_index" >= 0),
	CONSTRAINT "chk_capacity_workday_events_status" CHECK ("capacity_workday_events"."status" IN ('recorded','active','completed','warning','error','failed'))
);

CREATE TABLE "capacity_workday_participation_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"workday_run_id" text NOT NULL,
	"cycle_number" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" text NOT NULL,
	"covered_at" text,
	"closed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_workday_participation_cycles_number" CHECK ("capacity_workday_participation_cycles"."cycle_number" >= 1),
	CONSTRAINT "chk_capacity_workday_participation_cycles_status" CHECK ("capacity_workday_participation_cycles"."status" IN ('open','covered','closed'))
);

CREATE TABLE "capacity_workday_participation_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"workday_run_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"project_agent_class_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"demand_id" text,
	"assignment_id" text,
	"covered_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_workday_participation_entries_status" CHECK ("capacity_workday_participation_entries"."status" IN ('pending','assigned','completed','excluded','blocked'))
);

CREATE TABLE "capacity_workday_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text,
	"scenario_id" text DEFAULT 'portfolio-local' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"environment" text DEFAULT 'local' NOT NULL,
	"requested_by_id" text,
	"parameters_json" text DEFAULT '{}' NOT NULL,
	"summary_json" text DEFAULT '{}' NOT NULL,
	"metrics_json" text DEFAULT '{}' NOT NULL,
	"expected_json" text DEFAULT '{}' NOT NULL,
	"actual_json" text DEFAULT '{}' NOT NULL,
	"report_refs_json" text DEFAULT '{}' NOT NULL,
	"error_json" text DEFAULT '{}' NOT NULL,
	"started_at" text,
	"completed_at" text,
	"next_event_index" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_workday_runs_status" CHECK ("capacity_workday_runs"."status" IN ('queued','running','completed','cancelled','failed','degraded')),
	CONSTRAINT "chk_capacity_workday_runs_next_event" CHECK ("capacity_workday_runs"."next_event_index" >= 0)
);

CREATE TABLE "catalog_artifact_versions" (
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

CREATE TABLE "catalog_item_collaborators" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"role" text NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "catalog_items" (
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

CREATE TABLE "client_encrypted_escrow_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"secret_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ciphertext_ref" text NOT NULL,
	"algorithm" text NOT NULL,
	"wrapping_key_id" text NOT NULL,
	"created_by_client_id" text,
	"expires_at" text,
	"migrated_to" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"tombstoned_at" text
);

CREATE TABLE "commerce_buyer_stripe_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"vendor_id" text NOT NULL,
	"connected_account_id" text NOT NULL,
	"environment" text DEFAULT 'test' NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_capacity_listing_inquiries" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"product_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_service_type" text,
	"requested_scope" text NOT NULL,
	"data_access_requested_json" text DEFAULT '{}' NOT NULL,
	"secret_access_requested_json" text DEFAULT '{}' NOT NULL,
	"related_project_id" text,
	"related_workday_id" text,
	"governance_evidence_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_capacity_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"capacity_provider_id" text,
	"execution_provider_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"access_level" text DEFAULT 'public_summary' NOT NULL,
	"runtime_isolation_level" text DEFAULT 'none' NOT NULL,
	"human_involvement_level" text DEFAULT 'none' NOT NULL,
	"ai_involvement_level" text DEFAULT 'none' NOT NULL,
	"data_access_level" text DEFAULT 'none' NOT NULL,
	"secret_access_level" text DEFAULT 'none' NOT NULL,
	"supported_service_types_json" text DEFAULT '[]' NOT NULL,
	"supported_regions_json" text DEFAULT '[]' NOT NULL,
	"runtime_requirements_json" text DEFAULT '{}' NOT NULL,
	"data_handling_summary" text,
	"buyer_visible_risk_summary" text,
	"governance_requirements_json" text DEFAULT '{}' NOT NULL,
	"support_policy" text,
	"availability_summary" text,
	"ownership_snapshot_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_cart_items" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_version_id" text,
	"offer_id" text NOT NULL,
	"price_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_carts" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"currency" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"checkout_mode" text DEFAULT 'stripe_elements_grouped_vendor' NOT NULL,
	"group_count" integer DEFAULT 0 NOT NULL,
	"completed_group_count" integer DEFAULT 0 NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_contributions" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"product_version_id" text,
	"contributor_type" text NOT NULL,
	"contributor_id" text,
	"display_name" text,
	"role" text NOT NULL,
	"summary" text,
	"attribution_visibility" text DEFAULT 'public' NOT NULL,
	"agreement_ref" text,
	"benefit_weight" real,
	"effective_at" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"seller_team_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_version_id" text,
	"offer_id" text NOT NULL,
	"order_id" text,
	"order_item_id" text,
	"subscription_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"access_scope_json" text DEFAULT '{}' NOT NULL,
	"starts_at" text,
	"ends_at" text,
	"renewal_state" text DEFAULT 'none' NOT NULL,
	"fulfillment_artifact_refs_json" text DEFAULT '[]' NOT NULL,
	"project_id" text,
	"catalog_item_id" text,
	"ownership_snapshot_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_fulfillment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text,
	"entitlement_id" text,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_version_id" text,
	"catalog_item_id" text,
	"catalog_artifact_version_id" text,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"artifact_refs_json" text DEFAULT '[]' NOT NULL,
	"delivery_refs_json" text DEFAULT '[]' NOT NULL,
	"message" text,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "commerce_governance_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"prior_state" text,
	"next_state" text,
	"reason" text,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"related_order_id" text,
	"related_offer_id" text,
	"related_product_id" text,
	"related_team_id" text,
	"created_at" text NOT NULL
);

CREATE TABLE "commerce_governance_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text,
	"team_id" text,
	"policy_kind" text NOT NULL,
	"title" text NOT NULL,
	"approval_rules_json" text DEFAULT '{}' NOT NULL,
	"quorum_rules_json" text DEFAULT '{}' NOT NULL,
	"buyer_visible_summary" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"product_version_id" text,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"terms_summary" text,
	"access_scope_json" text DEFAULT '{}' NOT NULL,
	"support_scope_json" text DEFAULT '{}' NOT NULL,
	"fulfillment_mode" text DEFAULT 'automatic' NOT NULL,
	"active_price_id" text,
	"stripe_product_id" text,
	"stripe_product_status" text DEFAULT 'not_synced' NOT NULL,
	"stripe_product_synced_at" text,
	"stripe_product_sync_error" text,
	"stripe_product_metadata_json" text DEFAULT '{}' NOT NULL,
	"starts_at" text,
	"ends_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_version_id" text,
	"offer_id" text NOT NULL,
	"price_id" text,
	"mode" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"refund_status" text DEFAULT 'none' NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entitlement_id" text,
	"ownership_snapshot_json" text DEFAULT '{}' NOT NULL,
	"access_scope_json" text DEFAULT '{}' NOT NULL,
	"support_scope_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"checkout_id" text,
	"cart_id" text,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"vendor_id" text,
	"seller_team_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"refund_status" text DEFAULT 'none' NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"stripe_connected_account_id" text,
	"ownership_snapshot_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_ownership_records" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"model" text NOT NULL,
	"canonical_owner_type" text NOT NULL,
	"canonical_owner_id" text,
	"seller_team_id" text NOT NULL,
	"steward_team_id" text,
	"governance_policy_id" text,
	"public_summary" text,
	"buyer_visible" integer DEFAULT 1 NOT NULL,
	"effective_at" text NOT NULL,
	"superseded_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_ownership_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"from_ownership_record_id" text NOT NULL,
	"to_ownership_record_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"approval_evidence_json" text DEFAULT '{}' NOT NULL,
	"buyer_visible_impact" text,
	"effective_at" text NOT NULL,
	"requested_by_type" text DEFAULT 'user' NOT NULL,
	"requested_by_id" text DEFAULT 'system' NOT NULL,
	"approved_by_type" text,
	"approved_by_id" text,
	"approved_at" text,
	"rejected_at" text,
	"superseded_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "commerce_payment_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"checkout_id" text NOT NULL,
	"order_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"connected_account_id" text,
	"group_kind" text NOT NULL,
	"billing_interval" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"client_secret_last4" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"billing_interval" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"stripe_product_id" text,
	"stripe_price_id" text,
	"stripe_lookup_key" text,
	"stripe_sync_status" text DEFAULT 'not_synced' NOT NULL,
	"stripe_synced_at" text,
	"stripe_sync_error" text,
	"stripe_metadata_json" text DEFAULT '{}' NOT NULL,
	"price_version" integer DEFAULT 1 NOT NULL,
	"tax_behavior" text DEFAULT 'unspecified' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_product_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"catalog_artifact_version_id" text,
	"manifest_key" text,
	"artifact_key" text,
	"integrity" text,
	"release_notes" text,
	"compatibility_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"published_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_products" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"catalog_item_id" text,
	"current_version_id" text,
	"ownership_model" text DEFAULT 'team_owned' NOT NULL,
	"ownership_record_id" text,
	"support_policy" text,
	"license" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text,
	"payment_group_id" text,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"reason" text,
	"stripe_refund_id" text,
	"stripe_payment_intent_id" text,
	"stripe_connected_account_id" text,
	"idempotency_key" text NOT NULL,
	"requested_by_type" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"failure_reason" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_service_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"product_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"status" text DEFAULT 'pending_checkout' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"order_id" text,
	"order_item_id" text,
	"payment_group_id" text,
	"entitlement_id" text,
	"related_project_id" text,
	"related_workday_id" text,
	"ownership_snapshot_json" text DEFAULT '{}' NOT NULL,
	"access_approval_snapshot_json" text DEFAULT '{}' NOT NULL,
	"fulfillment_summary" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_service_events" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"quote_id" text,
	"contract_id" text,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"prior_state" text,
	"next_state" text,
	"message" text,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "commerce_service_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"quote_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"scope_summary" text NOT NULL,
	"deliverables_json" text DEFAULT '[]' NOT NULL,
	"assumptions_json" text DEFAULT '[]' NOT NULL,
	"access_requirements_json" text DEFAULT '{}' NOT NULL,
	"governance_requirements_json" text DEFAULT '{}' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"expires_at" text,
	"buyer_approved_at" text,
	"vendor_approved_at" text,
	"accepted_at" text,
	"rejected_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_service_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"product_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_scope" text NOT NULL,
	"approved_scope" text,
	"access_needs_json" text DEFAULT '{}' NOT NULL,
	"buyer_visible_summary" text,
	"vendor_private_notes" text,
	"active_quote_id" text,
	"approved_quote_id" text,
	"contract_id" text,
	"related_project_id" text,
	"related_workday_id" text,
	"order_id" text,
	"entitlement_id" text,
	"ownership_snapshot_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_stewardship_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"ownership_record_id" text NOT NULL,
	"product_id" text NOT NULL,
	"role" text NOT NULL,
	"assignee_type" text NOT NULL,
	"assignee_id" text,
	"display_name" text,
	"responsibilities_json" text DEFAULT '[]' NOT NULL,
	"visible_to_buyers" integer DEFAULT 1 NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"seller_team_id" text NOT NULL,
	"buyer_team_id" text,
	"buyer_user_id" text,
	"offer_id" text NOT NULL,
	"price_id" text NOT NULL,
	"status" text NOT NULL,
	"renewal_state" text DEFAULT 'active' NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_connected_account_id" text NOT NULL,
	"current_period_start" text,
	"current_period_end" text,
	"cancel_at_period_end" integer DEFAULT 0 NOT NULL,
	"canceled_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_succession_events" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"ownership_record_id" text,
	"stewardship_assignment_id" text,
	"successor_type" text NOT NULL,
	"successor_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reason" text,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"effective_at" text,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "commerce_vendor_stripe_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"team_id" text NOT NULL,
	"environment" text DEFAULT 'test' NOT NULL,
	"stripe_account_id" text NOT NULL,
	"account_status" text DEFAULT 'pending' NOT NULL,
	"onboarding_status" text DEFAULT 'not_started' NOT NULL,
	"charges_enabled" integer DEFAULT 0 NOT NULL,
	"payouts_enabled" integer DEFAULT 0 NOT NULL,
	"details_submitted" integer DEFAULT 0 NOT NULL,
	"requirements_currently_due_json" text DEFAULT '[]' NOT NULL,
	"requirements_eventually_due_json" text DEFAULT '[]' NOT NULL,
	"requirements_past_due_json" text DEFAULT '[]' NOT NULL,
	"requirements_disabled_reason" text,
	"capabilities_json" text DEFAULT '{}' NOT NULL,
	"onboarding_started_at" text,
	"onboarding_completed_at" text,
	"last_synced_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"trust_level" text DEFAULT 'public_publisher' NOT NULL,
	"professional_entitlement_id" text,
	"stripe_account_id" text,
	"sales_enabled" integer DEFAULT 0 NOT NULL,
	"service_sales_enabled" integer DEFAULT 0 NOT NULL,
	"capacity_listings_enabled" integer DEFAULT 0 NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commerce_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"environment" text DEFAULT 'test' NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"connected_account_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"object_type" text,
	"object_id" text,
	"related_order_id" text,
	"related_subscription_id" text,
	"payload_hash" text NOT NULL,
	"processing_error" text,
	"received_at" text NOT NULL,
	"processed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commons_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decision_record_id" text,
	"decision_record_slug" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"steward_reason" text,
	"capacity_budget" text,
	"scheduled_for" text,
	"implemented_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commons_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"from_participant_id" text NOT NULL,
	"to_participant_id" text NOT NULL,
	"scope" text DEFAULT 'treeseed_commons' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"weight_limit" real,
	"reason" text,
	"created_at" text NOT NULL,
	"revoked_at" text
);

CREATE TABLE "commons_governance_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"participant_id" text,
	"proposal_id" text,
	"question_id" text,
	"decision_id" text,
	"prior_state" text,
	"next_state" text,
	"message" text,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "commons_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"display_name" text,
	"verified_email" integer DEFAULT 0 NOT NULL,
	"base_weight" real DEFAULT 1 NOT NULL,
	"trust_weight" real DEFAULT 0 NOT NULL,
	"contribution_weight" real DEFAULT 0 NOT NULL,
	"stakeholder_weight" real DEFAULT 0 NOT NULL,
	"delegated_weight" real DEFAULT 0 NOT NULL,
	"total_weight" real DEFAULT 1 NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commons_proposal_backings" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"weight_snapshot_id" text NOT NULL,
	"weight" real NOT NULL,
	"reason" text,
	"created_at" text NOT NULL
);

CREATE TABLE "commons_proposal_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"vote" text NOT NULL,
	"weight_snapshot_id" text NOT NULL,
	"weight" real NOT NULL,
	"reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commons_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"scope" text DEFAULT 'treeseed_commons' NOT NULL,
	"decision_type" text DEFAULT 'advisory' NOT NULL,
	"content_proposal_slug" text,
	"content_decision_slug" text,
	"backing_count" integer DEFAULT 0 NOT NULL,
	"vote_support_weight" real DEFAULT 0 NOT NULL,
	"vote_object_weight" real DEFAULT 0 NOT NULL,
	"vote_abstain_weight" real DEFAULT 0 NOT NULL,
	"qualified_at" text,
	"voting_starts_at" text,
	"voting_ends_at" text,
	"steward_decision_at" text,
	"steward_decision_by" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commons_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"answer" text,
	"converted_proposal_id" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "commons_weight_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"participant_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"base_weight" real DEFAULT 1 NOT NULL,
	"verified_email_weight" real DEFAULT 0 NOT NULL,
	"account_age_weight" real DEFAULT 0 NOT NULL,
	"contribution_weight" real DEFAULT 0 NOT NULL,
	"stakeholder_weight" real DEFAULT 0 NOT NULL,
	"trust_role_weight" real DEFAULT 0 NOT NULL,
	"delegated_weight" real DEFAULT 0 NOT NULL,
	"total_weight" real DEFAULT 1 NOT NULL,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "contact_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "credit_conversion_profiles" (
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
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_credit_conversion_profiles_sample_counts" CHECK ("credit_conversion_profiles"."sample_count" >= 0 AND "credit_conversion_profiles"."completed_sample_count" >= 0 AND "credit_conversion_profiles"."interrupted_sample_count" >= 0 AND "credit_conversion_profiles"."completed_sample_count" + "credit_conversion_profiles"."interrupted_sample_count" <= "credit_conversion_profiles"."sample_count"),
	CONSTRAINT "chk_credit_conversion_profiles_native_p50" CHECK ("credit_conversion_profiles"."native_units_per_credit_p50" IS NULL OR "credit_conversion_profiles"."native_units_per_credit_p50" >= 0),
	CONSTRAINT "chk_credit_conversion_profiles_native_p90" CHECK ("credit_conversion_profiles"."native_units_per_credit_p90" IS NULL OR "credit_conversion_profiles"."native_units_per_credit_p90" >= 0),
	CONSTRAINT "chk_credit_conversion_profiles_credit_p50" CHECK ("credit_conversion_profiles"."credits_per_native_unit_p50" IS NULL OR "credit_conversion_profiles"."credits_per_native_unit_p50" >= 0),
	CONSTRAINT "chk_credit_conversion_profiles_credit_p90" CHECK ("credit_conversion_profiles"."credits_per_native_unit_p90" IS NULL OR "credit_conversion_profiles"."credits_per_native_unit_p90" >= 0),
	CONSTRAINT "chk_credit_conversion_profiles_actual_p50" CHECK ("credit_conversion_profiles"."actual_credits_p50" IS NULL OR "credit_conversion_profiles"."actual_credits_p50" >= 0),
	CONSTRAINT "chk_credit_conversion_profiles_actual_p90" CHECK ("credit_conversion_profiles"."actual_credits_p90" IS NULL OR "credit_conversion_profiles"."actual_credits_p90" >= 0),
	CONSTRAINT "chk_credit_conversion_profiles_confidence" CHECK ("credit_conversion_profiles"."confidence" IN ('low', 'medium', 'high'))
);

CREATE TABLE "cursor_state" (
	"agent_slug" text,
	"cursor_key" text,
	"status" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"updated_at" text NOT NULL,
	"payload_json" text NOT NULL,
	"meta_json" text NOT NULL,
	CONSTRAINT "cursor_state_agent_slug_cursor_key_pk" PRIMARY KEY("agent_slug","cursor_key")
);

CREATE TABLE "decision_assignment_graphs" (
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
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_decision_assignment_graphs_version" CHECK ("decision_assignment_graphs"."version" >= 1),
	CONSTRAINT "chk_decision_assignment_graphs_status" CHECK ("decision_assignment_graphs"."status" IN ('draft','compiled','ready','executing','completed','blocked')),
	CONSTRAINT "chk_decision_assignment_graphs_active" CHECK ("decision_assignment_graphs"."active" IN (0,1))
);

CREATE TABLE "decision_execution_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"work_graph_node_id" text,
	"project_agent_class_id" text NOT NULL,
	"mode" text DEFAULT 'acting' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"scope_hash" text NOT NULL,
	"input_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"accepted_at" text,
	"revision_requested_at" text,
	"stale_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_decision_execution_inputs_mode" CHECK ("decision_execution_inputs"."mode" IN ('planning','acting')),
	CONSTRAINT "chk_decision_execution_inputs_status" CHECK ("decision_execution_inputs"."status" IN ('proposed','accepted','revision_requested','rejected','stale'))
);

CREATE TABLE "decision_planning_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"human_approval_state" text,
	"execution_readiness" text DEFAULT 'draft' NOT NULL,
	"planning_inputs_status" text DEFAULT 'requested' NOT NULL,
	"scope_hash" text NOT NULL,
	"stale_reason" text,
	"ready_at" text,
	"stale_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_decision_planning_statuses_readiness" CHECK ("decision_planning_statuses"."execution_readiness" IN ('draft','blocked','ready','stale','waived')),
	CONSTRAINT "chk_decision_planning_statuses_inputs" CHECK ("decision_planning_statuses"."planning_inputs_status" IN ('requested','complete','waived','rejected','stale'))
);

CREATE TABLE "deliverable_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"deliverable_type" text NOT NULL,
	"status" text NOT NULL,
	"contract_json" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_deliverable_contracts_status" CHECK ("deliverable_contracts"."status" IN ('required','draft','submitted','approved','rejected'))
);

CREATE TABLE "deliverable_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"deliverable_contract_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"ready_for_review" integer DEFAULT 0 NOT NULL,
	"manifest_json" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"submitted_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_deliverable_manifests_ready" CHECK ("deliverable_manifests"."ready_for_review" IN (0,1))
);

CREATE TABLE "device_codes" (
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

CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"project_id" text,
	"tier" text NOT NULL,
	"status" text NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "github_app_installation_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text,
	"account_id" text,
	"account_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions_json" text DEFAULT '{}' NOT NULL,
	"repository_selection" text,
	"drift_code" text,
	"observed_at" text,
	"revoked_at" text,
	"suspended_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "github_app_token_issuance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"assignment_id" text,
	"provider_id" text,
	"workday_id" text,
	"operation_id" text,
	"repository" text NOT NULL,
	"installation_id" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"token_prefix" text,
	"token_hash" text,
	"permissions_json" text DEFAULT '{}' NOT NULL,
	"allowed_operations_json" text DEFAULT '[]' NOT NULL,
	"expires_at" text,
	"issued_at" text,
	"revoked_at" text,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "github_repository_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"repository" text NOT NULL,
	"installation_id" text,
	"account_login" text,
	"account_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions_json" text DEFAULT '{}' NOT NULL,
	"environments_json" text DEFAULT '[]' NOT NULL,
	"drift_code" text,
	"observed_at" text,
	"revoked_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "governance_decisions" (
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

CREATE TABLE "governance_delegations" (
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

CREATE TABLE "governance_electorate_snapshots" (
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

CREATE TABLE "governance_events" (
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

CREATE TABLE "governance_proposal_versions" (
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

CREATE TABLE "governance_proposal_votes" (
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

CREATE TABLE "governance_proposals" (
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

CREATE TABLE "governance_vote_events" (
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

CREATE TABLE "hub_content_sources" (
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

CREATE TABLE "hub_launch_events" (
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

CREATE TABLE "hub_launches" (
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

CREATE TABLE "hub_repositories" (
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

CREATE TABLE "hub_workspace_links" (
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

CREATE TABLE "knowledge_packs" (
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

CREATE TABLE "lease_state" (
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

CREATE TABLE "market_auth_credentials" (
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

CREATE TABLE "market_auth_password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "market_auth_password_resets_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "market_operation_runners" (
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

CREATE TABLE "message_queue" (
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

CREATE TABLE "notification_email_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_id" text,
	"digest_key" text NOT NULL,
	"cadence" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" text,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "notification_email_deliveries_digest_key_unique" UNIQUE("digest_key")
);

CREATE TABLE "notification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"content_type" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_id" text,
	"resource_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"target_url" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"scope" text NOT NULL,
	"description" text,
	"created_at" text NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);

CREATE TABLE "planning_input_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"project_agent_class_id" text,
	"mode" text DEFAULT 'planning' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"scope_hash" text NOT NULL,
	"prompt" text,
	"response_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"requested_at" text NOT NULL,
	"completed_at" text,
	"stale_at" text,
	CONSTRAINT "chk_planning_input_requests_mode" CHECK ("planning_input_requests"."mode" IN ('planning','acting')),
	CONSTRAINT "chk_planning_input_requests_status" CHECK ("planning_input_requests"."status" IN ('requested','complete','waived','rejected','stale'))
);

CREATE TABLE "platform_operation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"data_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "platform_operations" (
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

CREATE TABLE "platform_repository_claims" (
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

CREATE TABLE "project_agent_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"allowed_modes_json" text DEFAULT '[]' NOT NULL,
	"required_capabilities_json" text DEFAULT '[]' NOT NULL,
	"kernel_profile_json" text DEFAULT '{}' NOT NULL,
	"kernel_policy_json" text DEFAULT '{}' NOT NULL,
	"handler_refs_json" text DEFAULT '{}' NOT NULL,
	"output_contracts_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_project_agent_classes_status" CHECK ("project_agent_classes"."status" IN ('active', 'paused', 'archived'))
);

CREATE TABLE "project_capability_grants" (
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

CREATE TABLE "project_connections" (
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

CREATE TABLE "project_deployment_events" (
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

CREATE TABLE "project_deployments" (
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

CREATE TABLE "project_environments" (
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

CREATE TABLE "project_governance_policies" (
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

CREATE TABLE "project_hosting" (
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

CREATE TABLE "project_infrastructure_resources" (
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

CREATE TABLE "project_summary_snapshots" (
	"project_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"summary_json" text NOT NULL,
	"generated_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "project_update_plans" (
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

CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "capacity_provider_availability_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"environment" text,
	"status" text DEFAULT 'open' NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"opened_at" text NOT NULL,
	"refreshed_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"available_from" text NOT NULL,
	"available_until" text,
	"execution_providers_json" text DEFAULT '[]' NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"native_limits_json" text DEFAULT '{}' NOT NULL,
	"runner_pressure_json" text DEFAULT '{}' NOT NULL,
	"constraints_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"closed_at" text,
	CONSTRAINT "chk_capacity_provider_availability_sessions_sequence" CHECK ("capacity_provider_availability_sessions"."sequence" >= 1),
	CONSTRAINT "chk_capacity_provider_availability_sessions_status" CHECK ("capacity_provider_availability_sessions"."status" IN ('open', 'draining', 'closed', 'expired'))
);

CREATE TABLE "provider_credential_sessions" (
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

CREATE TABLE "remote_job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"data_json" text,
	"created_at" text NOT NULL
);

CREATE TABLE "remote_jobs" (
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

CREATE TABLE "repository_hosts" (
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

CREATE TABLE "research_workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"objective_ref" text NOT NULL,
	"question_ref" text NOT NULL,
	"status" text NOT NULL,
	"state_version" integer NOT NULL,
	"workflow_json" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_research_workflows_status" CHECK ("research_workflows"."status" IN ('ready','running','completed','blocked','failed')),
	CONSTRAINT "chk_research_workflows_state_version" CHECK ("research_workflows"."state_version" >= 1)
);

CREATE TABLE "role_permissions" (
	"role_id" text,
	"permission_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);

CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"created_at" text NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);

CREATE TABLE "runtime_envelopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"record_type" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "runtime_records" (
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

CREATE TABLE "secret_metadata_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"secret_class" text NOT NULL,
	"custody_mode" text NOT NULL,
	"owner_kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"github_secret_target_json" text DEFAULT '{}' NOT NULL,
	"escrow_record_id" text,
	"api_decryptable" integer DEFAULT 0 NOT NULL,
	"plaintext_allowed" integer DEFAULT 0 NOT NULL,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"tombstoned_at" text
);

CREATE TABLE "seed_runs" (
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

CREATE TABLE "service_credentials" (
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

CREATE TABLE "structured_agent_estimates" (
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
	"rejected_at" text,
	CONSTRAINT "chk_structured_agent_estimates_status" CHECK ("structured_agent_estimates"."status" IN ('submitted','accepted','rejected','superseded'))
);

CREATE TABLE "subscribers" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "team_api_keys" (
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

CREATE TABLE "team_capacity_registration_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"generation" integer NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"encrypted_reveal_value" text NOT NULL,
	"rotation_idempotency_key" text,
	"status_idempotency_key" text,
	"status_request_digest" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"rotated_at" text,
	"last_revealed_at" text,
	CONSTRAINT "chk_team_capacity_registration_keys_generation" CHECK ("team_capacity_registration_keys"."generation" >= 1),
	CONSTRAINT "chk_team_capacity_registration_keys_status" CHECK ("team_capacity_registration_keys"."status" IN ('active', 'disabled'))
);

CREATE TABLE "team_governance_policies" (
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

CREATE TABLE "team_inbox_items" (
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

CREATE TABLE "team_invites" (
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

CREATE TABLE "team_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "team_role_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"team_membership_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "team_storage_locators" (
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

CREATE TABLE "team_web_hosts" (
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

CREATE TABLE "teams" (
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

CREATE TABLE "treedx_credential_issuance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text,
	"repository" text,
	"credential_provider" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"token_prefix" text,
	"token_hash" text,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"allowed_operations_json" text DEFAULT '[]' NOT NULL,
	"expires_at" text,
	"issued_at" text,
	"revoked_at" text,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "treedx_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"instance_id" text,
	"provider" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"image_ref" text,
	"volume_mount_path" text,
	"service_refs_json" text DEFAULT '{}' NOT NULL,
	"result_json" text DEFAULT '{}' NOT NULL,
	"error_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);

CREATE TABLE "treedx_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text,
	"registry_url" text,
	"public_read" integer DEFAULT 0 NOT NULL,
	"primary" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"image_ref" text,
	"railway_project_id" text,
	"railway_service_id" text,
	"railway_environment_id" text,
	"volume_mount_path" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "treedx_mirrors" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"direction" text DEFAULT 'bidirectional' NOT NULL,
	"target_kind" text NOT NULL,
	"target_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"instructions" text,
	"last_sync_at" text,
	"last_sync_status" text,
	"last_sync_metadata_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "treedx_project_libraries" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"library_id" text NOT NULL,
	"repository_id" text,
	"content_path" text DEFAULT 'src/content' NOT NULL,
	"content_repository_url" text,
	"content_repository_default_branch" text,
	"content_repository_ref" text,
	"r2_bucket_name" text,
	"r2_manifest_key" text,
	"topology_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "treedx_project_proxy_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"handle_json" text DEFAULT '{}' NOT NULL,
	"result_status" text DEFAULT 'observed' NOT NULL,
	"reason_code" text,
	"reason" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "treedx_proxy_handles" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text,
	"repository_id" text,
	"workspace_id" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"allowed_operations_json" text DEFAULT '[]' NOT NULL,
	"allowed_paths_json" text DEFAULT '[]' NOT NULL,
	"allowed_read_paths_json" text DEFAULT '[]' NOT NULL,
	"allowed_write_paths_json" text DEFAULT '[]' NOT NULL,
	"token_hash" text,
	"expires_at" text,
	"issued_at" text NOT NULL,
	"revoked_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "treedx_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"instance_id" text,
	"project_id" text,
	"library_id" text,
	"scope" text NOT NULL,
	"target_team_id" text,
	"trust_grant_json" text DEFAULT '{}' NOT NULL,
	"public_read" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"revoked_at" text
);

CREATE TABLE "user_email_addresses" (
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

CREATE TABLE "user_identities" (
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

CREATE TABLE "user_notification_global_content_types" (
	"user_id" text NOT NULL,
	"content_type" text NOT NULL,
	CONSTRAINT "user_notification_global_content_types_user_id_content_type_pk" PRIMARY KEY("user_id","content_type")
);

CREATE TABLE "user_notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_cadence" text DEFAULT 'daily' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "user_notification_project_content_types" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"content_type" text NOT NULL,
	CONSTRAINT "user_notification_project_content_types_user_id_project_id_content_type_pk" PRIMARY KEY("user_id","project_id","content_type")
);

CREATE TABLE "user_notification_project_overrides" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "user_notification_project_overrides_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);

CREATE TABLE "user_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_id" text NOT NULL,
	"read_at" text,
	"created_at" text NOT NULL
);

CREATE TABLE "user_personal_themes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"base_scheme" text NOT NULL,
	"palette_json" text NOT NULL,
	"compiler_version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"color_scheme" text DEFAULT 'fern' NOT NULL,
	"theme_mode" text DEFAULT 'system' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "user_role_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"username" text
);

CREATE TABLE "web_sessions" (
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

CREATE TABLE "workday_capacity_envelopes" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"workday_run_id" text,
	"allocation_set_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"started_at" text,
	"paused_at" text,
	"completed_at" text,
	"envelope_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_workday_capacity_envelopes_status" CHECK ("workday_capacity_envelopes"."status" IN ('draft','queued','active','paused','completed','cancelled','failed','degraded'))
);

CREATE TABLE "workflow_dispatch_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"workflow_operation_id" text NOT NULL,
	"platform_operation_id" text,
	"repository" text NOT NULL,
	"workflow_file" text NOT NULL,
	"ref" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"inputs_json" text DEFAULT '{}' NOT NULL,
	"result_json" text DEFAULT '{}' NOT NULL,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"dispatched_at" text,
	"completed_at" text
);

CREATE TABLE "workflow_operation_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"repository" text NOT NULL,
	"workflow_file" text NOT NULL,
	"secret_bearing" integer DEFAULT 0 NOT NULL,
	"trusted_execution_set_id" text NOT NULL,
	"dispatch_json" text DEFAULT '{}' NOT NULL,
	"inputs_json" text DEFAULT '[]' NOT NULL,
	"secret_classes_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"blocked_at" text
);

ALTER TABLE "agent_capacity_plans" ADD CONSTRAINT "fk_agent_capacity_plans_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_capacity_plans" ADD CONSTRAINT "fk_agent_capacity_plans_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_capacity_plans" ADD CONSTRAINT "fk_agent_capacity_plans_allocation" FOREIGN KEY ("allocation_set_id") REFERENCES "public"."capacity_allocation_sets"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_capacity_plans" ADD CONSTRAINT "fk_agent_capacity_plans_workday" FOREIGN KEY ("work_day_id") REFERENCES "public"."workday_capacity_envelopes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_fallback_outputs" ADD CONSTRAINT "fk_agent_fallback_outputs_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_fallback_outputs" ADD CONSTRAINT "fk_agent_fallback_outputs_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_fallback_outputs" ADD CONSTRAINT "fk_agent_fallback_outputs_assignment" FOREIGN KEY ("assignment_id") REFERENCES "public"."capacity_provider_assignments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "fk_agent_mode_runs_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "fk_agent_mode_runs_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "fk_agent_mode_runs_assignment" FOREIGN KEY ("provider_assignment_id") REFERENCES "public"."capacity_provider_assignments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "fk_agent_mode_runs_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "fk_agent_mode_runs_execution_provider" FOREIGN KEY ("capacity_provider_id","execution_provider_id") REFERENCES "public"."capacity_execution_providers"("capacity_provider_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "fk_agent_mode_runs_agent_class" FOREIGN KEY ("project_agent_class_id") REFERENCES "public"."project_agent_classes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_allocation_sets" ADD CONSTRAINT "fk_capacity_allocation_sets_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_allocation_sets" ADD CONSTRAINT "fk_capacity_allocation_sets_superseded_by" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."capacity_allocation_sets"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_execution_providers" ADD CONSTRAINT "fk_capacity_execution_providers_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_grants" ADD CONSTRAINT "fk_capacity_grants_membership" FOREIGN KEY ("membership_id") REFERENCES "public"."capacity_provider_team_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_grants" ADD CONSTRAINT "fk_capacity_grants_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_grants" ADD CONSTRAINT "fk_capacity_grants_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_grants" ADD CONSTRAINT "fk_capacity_grants_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "fk_capacity_ledger_membership" FOREIGN KEY ("membership_id") REFERENCES "public"."capacity_provider_team_memberships"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "fk_capacity_ledger_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "fk_capacity_ledger_reservation" FOREIGN KEY ("reservation_id") REFERENCES "public"."capacity_reservations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "fk_capacity_ledger_assignment" FOREIGN KEY ("assignment_id") REFERENCES "public"."capacity_provider_assignments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "fk_capacity_ledger_mode_run" FOREIGN KEY ("mode_run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "fk_capacity_ledger_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_ledger_entries" ADD CONSTRAINT "fk_capacity_ledger_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_operation_receipts" ADD CONSTRAINT "fk_capacity_operation_receipts_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_access_tokens" ADD CONSTRAINT "fk_capacity_provider_access_tokens_membership" FOREIGN KEY ("membership_id") REFERENCES "public"."capacity_provider_team_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_access_tokens" ADD CONSTRAINT "fk_capacity_provider_access_tokens_credential" FOREIGN KEY ("credential_id") REFERENCES "public"."capacity_provider_team_credentials"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_membership" FOREIGN KEY ("membership_id") REFERENCES "public"."capacity_provider_team_memberships"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_session" FOREIGN KEY ("provider_session_id") REFERENCES "public"."capacity_provider_availability_sessions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_execution_provider" FOREIGN KEY ("capacity_provider_id","execution_provider_id") REFERENCES "public"."capacity_execution_providers"("capacity_provider_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_lane" FOREIGN KEY ("capacity_provider_id","lane_id") REFERENCES "public"."capacity_provider_lanes"("capacity_provider_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_allocation" FOREIGN KEY ("allocation_set_id") REFERENCES "public"."capacity_allocation_sets"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_agent_class" FOREIGN KEY ("project_agent_class_id") REFERENCES "public"."project_agent_classes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_assignments" ADD CONSTRAINT "fk_capacity_provider_assignments_reservation" FOREIGN KEY ("reservation_id") REFERENCES "public"."capacity_reservations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_credential_issuance_authorizations" ADD CONSTRAINT "fk_capacity_provider_credential_authorizations_membership" FOREIGN KEY ("membership_id") REFERENCES "public"."capacity_provider_team_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_credential_issuance_authorizations" ADD CONSTRAINT "fk_capacity_provider_credential_authorizations_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_credential_issuance_authorizations" ADD CONSTRAINT "fk_capacity_provider_credential_authorizations_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_identity_rotations" ADD CONSTRAINT "fk_capacity_provider_identity_rotations_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_lanes" ADD CONSTRAINT "fk_capacity_provider_lanes_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_lanes" ADD CONSTRAINT "fk_capacity_provider_lanes_execution_provider" FOREIGN KEY ("capacity_provider_id","execution_provider_id") REFERENCES "public"."capacity_execution_providers"("capacity_provider_id","id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_registration_requests" ADD CONSTRAINT "fk_capacity_provider_registration_requests_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_registration_requests" ADD CONSTRAINT "fk_capacity_provider_registration_requests_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_team_credentials" ADD CONSTRAINT "fk_capacity_provider_team_credentials_membership" FOREIGN KEY ("membership_id") REFERENCES "public"."capacity_provider_team_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_team_credentials" ADD CONSTRAINT "fk_capacity_provider_team_credentials_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_team_credentials" ADD CONSTRAINT "fk_capacity_provider_team_credentials_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_team_credentials" ADD CONSTRAINT "fk_capacity_provider_team_credentials_authorization" FOREIGN KEY ("issuance_authorization_id") REFERENCES "public"."capacity_provider_credential_issuance_authorizations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_provider_team_credentials" ADD CONSTRAINT "fk_capacity_provider_team_credentials_rotated_from" FOREIGN KEY ("rotated_from_credential_id") REFERENCES "public"."capacity_provider_team_credentials"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "capacity_provider_team_memberships" ADD CONSTRAINT "fk_capacity_provider_team_memberships_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_team_memberships" ADD CONSTRAINT "fk_capacity_provider_team_memberships_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_membership" FOREIGN KEY ("membership_id") REFERENCES "public"."capacity_provider_team_memberships"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_grant" FOREIGN KEY ("grant_id") REFERENCES "public"."capacity_grants"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_execution_provider" FOREIGN KEY ("capacity_provider_id","execution_provider_id") REFERENCES "public"."capacity_execution_providers"("capacity_provider_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_lane" FOREIGN KEY ("capacity_provider_id","lane_id") REFERENCES "public"."capacity_provider_lanes"("capacity_provider_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_allocation" FOREIGN KEY ("allocation_set_id") REFERENCES "public"."capacity_allocation_sets"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_agent_class" FOREIGN KEY ("project_agent_class_id") REFERENCES "public"."project_agent_classes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "fk_capacity_reservations_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_usage_actuals" ADD CONSTRAINT "fk_capacity_usage_actuals_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_usage_actuals" ADD CONSTRAINT "fk_capacity_usage_actuals_assignment" FOREIGN KEY ("assignment_id") REFERENCES "public"."capacity_provider_assignments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_usage_actuals" ADD CONSTRAINT "fk_capacity_usage_actuals_mode_run" FOREIGN KEY ("mode_run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_usage_actuals" ADD CONSTRAINT "fk_capacity_usage_actuals_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_usage_actuals" ADD CONSTRAINT "fk_capacity_usage_actuals_execution_provider" FOREIGN KEY ("capacity_provider_id","execution_provider_id") REFERENCES "public"."capacity_execution_providers"("capacity_provider_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_usage_actuals" ADD CONSTRAINT "fk_capacity_usage_actuals_lane" FOREIGN KEY ("capacity_provider_id","lane_id") REFERENCES "public"."capacity_provider_lanes"("capacity_provider_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_demands" ADD CONSTRAINT "fk_capacity_workday_demands_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_workday_demands" ADD CONSTRAINT "fk_capacity_workday_demands_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_demands" ADD CONSTRAINT "fk_capacity_workday_demands_run" FOREIGN KEY ("workday_run_id") REFERENCES "public"."capacity_workday_runs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_demands" ADD CONSTRAINT "fk_capacity_workday_demands_workday" FOREIGN KEY ("workday_id") REFERENCES "public"."workday_capacity_envelopes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_demands" ADD CONSTRAINT "fk_capacity_workday_demands_agent_class" FOREIGN KEY ("project_agent_class_id") REFERENCES "public"."project_agent_classes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_demands" ADD CONSTRAINT "fk_capacity_workday_demands_assignment" FOREIGN KEY ("assignment_id") REFERENCES "public"."capacity_provider_assignments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_demands" ADD CONSTRAINT "fk_capacity_workday_demands_capacity_plan" FOREIGN KEY ("capacity_plan_id") REFERENCES "public"."agent_capacity_plans"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_events" ADD CONSTRAINT "fk_capacity_workday_events_run" FOREIGN KEY ("run_id") REFERENCES "public"."capacity_workday_runs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_events" ADD CONSTRAINT "fk_capacity_workday_events_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_workday_events" ADD CONSTRAINT "fk_capacity_workday_events_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_cycles" ADD CONSTRAINT "fk_capacity_workday_participation_cycles_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_cycles" ADD CONSTRAINT "fk_capacity_workday_participation_cycles_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_cycles" ADD CONSTRAINT "fk_capacity_workday_participation_cycles_run" FOREIGN KEY ("workday_run_id") REFERENCES "public"."capacity_workday_runs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_entries" ADD CONSTRAINT "fk_capacity_workday_participation_entries_cycle" FOREIGN KEY ("cycle_id") REFERENCES "public"."capacity_workday_participation_cycles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_entries" ADD CONSTRAINT "fk_capacity_workday_participation_entries_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_entries" ADD CONSTRAINT "fk_capacity_workday_participation_entries_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_entries" ADD CONSTRAINT "fk_capacity_workday_participation_entries_run" FOREIGN KEY ("workday_run_id") REFERENCES "public"."capacity_workday_runs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_entries" ADD CONSTRAINT "fk_capacity_workday_participation_entries_agent_class" FOREIGN KEY ("project_agent_class_id") REFERENCES "public"."project_agent_classes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_entries" ADD CONSTRAINT "fk_capacity_workday_participation_entries_demand" FOREIGN KEY ("demand_id") REFERENCES "public"."capacity_workday_demands"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_participation_entries" ADD CONSTRAINT "fk_capacity_workday_participation_entries_assignment" FOREIGN KEY ("assignment_id") REFERENCES "public"."capacity_provider_assignments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "capacity_workday_runs" ADD CONSTRAINT "fk_capacity_workday_runs_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_assignment_graphs" ADD CONSTRAINT "fk_decision_assignment_graphs_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_assignment_graphs" ADD CONSTRAINT "fk_decision_assignment_graphs_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_execution_inputs" ADD CONSTRAINT "fk_decision_execution_inputs_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_execution_inputs" ADD CONSTRAINT "fk_decision_execution_inputs_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_execution_inputs" ADD CONSTRAINT "fk_decision_execution_inputs_agent_class" FOREIGN KEY ("project_agent_class_id") REFERENCES "public"."project_agent_classes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "decision_planning_statuses" ADD CONSTRAINT "fk_decision_planning_statuses_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_planning_statuses" ADD CONSTRAINT "fk_decision_planning_statuses_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deliverable_contracts" ADD CONSTRAINT "fk_deliverable_contracts_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deliverable_contracts" ADD CONSTRAINT "fk_deliverable_contracts_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deliverable_manifests" ADD CONSTRAINT "fk_deliverable_manifests_contract" FOREIGN KEY ("deliverable_contract_id") REFERENCES "public"."deliverable_contracts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deliverable_manifests" ADD CONSTRAINT "fk_deliverable_manifests_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "planning_input_requests" ADD CONSTRAINT "fk_planning_input_requests_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "planning_input_requests" ADD CONSTRAINT "fk_planning_input_requests_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "planning_input_requests" ADD CONSTRAINT "fk_planning_input_requests_agent_class" FOREIGN KEY ("project_agent_class_id") REFERENCES "public"."project_agent_classes"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "project_agent_classes" ADD CONSTRAINT "fk_project_agent_classes_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_agent_classes" ADD CONSTRAINT "fk_project_agent_classes_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_availability_sessions" ADD CONSTRAINT "fk_capacity_provider_availability_sessions_membership" FOREIGN KEY ("membership_id") REFERENCES "public"."capacity_provider_team_memberships"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_availability_sessions" ADD CONSTRAINT "fk_capacity_provider_availability_sessions_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "capacity_provider_availability_sessions" ADD CONSTRAINT "fk_capacity_provider_availability_sessions_provider" FOREIGN KEY ("capacity_provider_id") REFERENCES "public"."capacity_providers"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "research_workflows" ADD CONSTRAINT "fk_research_workflows_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_workflows" ADD CONSTRAINT "fk_research_workflows_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "structured_agent_estimates" ADD CONSTRAINT "fk_structured_agent_estimates_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "structured_agent_estimates" ADD CONSTRAINT "fk_structured_agent_estimates_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "team_capacity_registration_keys" ADD CONSTRAINT "fk_team_capacity_registration_keys_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workday_capacity_envelopes" ADD CONSTRAINT "workday_capacity_envelopes_workday_run_id_capacity_workday_runs_id_fk" FOREIGN KEY ("workday_run_id") REFERENCES "public"."capacity_workday_runs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "workday_capacity_envelopes" ADD CONSTRAINT "fk_workday_capacity_envelopes_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workday_capacity_envelopes" ADD CONSTRAINT "fk_workday_capacity_envelopes_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "workday_capacity_envelopes" ADD CONSTRAINT "fk_workday_capacity_envelopes_allocation" FOREIGN KEY ("allocation_set_id") REFERENCES "public"."capacity_allocation_sets"("id") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "idx_agent_capacity_plans_decision" ON "agent_capacity_plans" USING btree ("decision_id","status","created_at");
CREATE INDEX "idx_agent_capacity_plans_project" ON "agent_capacity_plans" USING btree ("project_id","status","created_at");
CREATE INDEX "idx_agent_capacity_plans_workday" ON "agent_capacity_plans" USING btree ("work_day_id","status","created_at");
CREATE INDEX "idx_agent_fallback_outputs_project_created" ON "agent_fallback_outputs" USING btree ("project_id","created_at");
CREATE INDEX "idx_agent_fallback_outputs_project_mode_status" ON "agent_fallback_outputs" USING btree ("project_id","mode","status","created_at");
CREATE INDEX "idx_agent_fallback_outputs_assignment" ON "agent_fallback_outputs" USING btree ("assignment_id","created_at");
CREATE INDEX "idx_agent_mode_runs_assignment" ON "agent_mode_runs" USING btree ("provider_assignment_id","status");
CREATE INDEX "idx_agent_mode_runs_project_mode" ON "agent_mode_runs" USING btree ("project_id","mode","created_at");
CREATE INDEX "idx_agent_mode_runs_provider" ON "agent_mode_runs" USING btree ("capacity_provider_id","created_at");
CREATE INDEX "idx_api_tokens_user_id" ON "api_tokens" USING btree ("user_id");
CREATE INDEX "idx_api_tokens_prefix" ON "api_tokens" USING btree ("token_prefix");
CREATE INDEX "idx_approval_requests_team_state" ON "approval_requests" USING btree ("team_id","state","created_at");
CREATE INDEX "idx_approval_requests_project_workday" ON "approval_requests" USING btree ("project_id","work_day_id","state","created_at");
CREATE INDEX "idx_audit_events_target" ON "audit_events" USING btree ("target_type","target_id");
CREATE INDEX "idx_auth_provider_states_expiry" ON "auth_provider_states" USING btree ("expires_at","used_at");
CREATE INDEX "idx_auth_reauthentication_grants_session" ON "auth_reauthentication_grants" USING btree ("user_id","session_id","action","expires_at");
CREATE INDEX "idx_auth_sessions_user_id" ON "auth_sessions" USING btree ("user_id");
CREATE INDEX "idx_better_auth_account_userId" ON "better_auth_account" USING btree ("userId");
CREATE UNIQUE INDEX "idx_better_auth_account_provider_account" ON "better_auth_account" USING btree ("providerId","accountId");
CREATE INDEX "idx_better_auth_session_token" ON "better_auth_session" USING btree ("token");
CREATE INDEX "idx_better_auth_session_userId" ON "better_auth_session" USING btree ("userId");
CREATE UNIQUE INDEX "idx_better_auth_user_username" ON "better_auth_user" USING btree ("username");
CREATE INDEX "idx_better_auth_verification_identifier" ON "better_auth_verification" USING btree ("identifier");
CREATE UNIQUE INDEX "idx_capacity_admission_counters_scope" ON "capacity_admission_counters" USING btree ("team_id","scope","scope_id","period_key");
CREATE INDEX "idx_capacity_admission_counters_team" ON "capacity_admission_counters" USING btree ("team_id","updated_at");
CREATE UNIQUE INDEX "idx_capacity_allocation_sets_team_version" ON "capacity_allocation_sets" USING btree ("team_id","version");
CREATE INDEX "idx_capacity_allocation_sets_team_status" ON "capacity_allocation_sets" USING btree ("team_id","status","effective_from");
CREATE INDEX "idx_capacity_allocation_sets_team_created" ON "capacity_allocation_sets" USING btree ("team_id","created_at");
CREATE INDEX "idx_capacity_audit_events_team_created" ON "capacity_audit_events" USING btree ("team_id","created_at");
CREATE INDEX "idx_capacity_audit_events_provider_created" ON "capacity_audit_events" USING btree ("capacity_provider_id","created_at");
CREATE INDEX "idx_capacity_audit_events_membership_created" ON "capacity_audit_events" USING btree ("membership_id","created_at");
CREATE INDEX "idx_capacity_audit_events_resource" ON "capacity_audit_events" USING btree ("resource_type","resource_id","created_at");
CREATE UNIQUE INDEX "idx_capacity_audit_events_idempotency" ON "capacity_audit_events" USING btree ("team_id","action","resource_type","resource_id","idempotency_key");
CREATE UNIQUE INDEX "idx_capacity_execution_providers_provider_adapter" ON "capacity_execution_providers" USING btree ("capacity_provider_id","adapter","id");
CREATE INDEX "idx_capacity_execution_providers_provider_status" ON "capacity_execution_providers" USING btree ("capacity_provider_id","status","updated_at");
CREATE INDEX "idx_capacity_grants_team_project" ON "capacity_grants" USING btree ("team_id","project_id","status");
CREATE INDEX "idx_capacity_grants_membership" ON "capacity_grants" USING btree ("membership_id","status","expires_at");
CREATE INDEX "idx_capacity_grants_provider" ON "capacity_grants" USING btree ("capacity_provider_id","status");
CREATE UNIQUE INDEX "idx_capacity_ledger_settlement_key" ON "capacity_ledger_entries" USING btree ("settlement_key");
CREATE UNIQUE INDEX "idx_capacity_ledger_reservation_phase" ON "capacity_ledger_entries" USING btree ("reservation_id","phase");
CREATE INDEX "idx_capacity_ledger_assignment" ON "capacity_ledger_entries" USING btree ("assignment_id","created_at");
CREATE INDEX "idx_capacity_ledger_project_workday_created" ON "capacity_ledger_entries" USING btree ("project_id","work_day_id","created_at");
CREATE UNIQUE INDEX "idx_capacity_operation_receipts_idempotency" ON "capacity_operation_receipts" USING btree ("team_id","operation","idempotency_key");
CREATE INDEX "idx_capacity_operation_receipts_resource" ON "capacity_operation_receipts" USING btree ("team_id","resource_type","resource_id","created_at");
CREATE UNIQUE INDEX "idx_capacity_provider_access_tokens_prefix" ON "capacity_provider_access_tokens" USING btree ("token_prefix");
CREATE UNIQUE INDEX "idx_capacity_provider_access_tokens_issue" ON "capacity_provider_access_tokens" USING btree ("membership_id","idempotency_key");
CREATE INDEX "idx_capacity_provider_access_tokens_membership" ON "capacity_provider_access_tokens" USING btree ("membership_id","status","expires_at");
CREATE INDEX "idx_capacity_provider_assignments_membership_status" ON "capacity_provider_assignments" USING btree ("membership_id","status","lease_expires_at");
CREATE INDEX "idx_capacity_provider_assignments_provider_status" ON "capacity_provider_assignments" USING btree ("capacity_provider_id","status","lease_expires_at");
CREATE INDEX "idx_capacity_provider_assignments_lane_status" ON "capacity_provider_assignments" USING btree ("lane_id","status","lease_expires_at");
CREATE INDEX "idx_capacity_provider_assignments_project_mode" ON "capacity_provider_assignments" USING btree ("project_id","mode","status");
CREATE INDEX "idx_capacity_provider_assignments_lease" ON "capacity_provider_assignments" USING btree ("capacity_provider_id","lease_state","lease_expires_at");
CREATE INDEX "idx_capacity_provider_assignments_runner" ON "capacity_provider_assignments" USING btree ("runner_id","lease_state");
CREATE UNIQUE INDEX "idx_capacity_provider_assignments_synthesis_key" ON "capacity_provider_assignments" USING btree ("team_id","synthesis_key");
CREATE INDEX "idx_capacity_provider_assignments_decision" ON "capacity_provider_assignments" USING btree ("decision_id","status");
CREATE INDEX "idx_capacity_provider_assignments_team_created" ON "capacity_provider_assignments" USING btree ("team_id","created_at");
CREATE UNIQUE INDEX "idx_capacity_provider_credential_authorizations_generation" ON "capacity_provider_credential_issuance_authorizations" USING btree ("membership_id","generation");
CREATE UNIQUE INDEX "idx_capacity_provider_credential_authorizations_idempotency" ON "capacity_provider_credential_issuance_authorizations" USING btree ("membership_id","idempotency_key");
CREATE INDEX "idx_capacity_provider_credential_authorizations_pending" ON "capacity_provider_credential_issuance_authorizations" USING btree ("membership_id","status","created_at");
CREATE UNIQUE INDEX "idx_capacity_provider_identity_rotations_idempotency" ON "capacity_provider_identity_rotations" USING btree ("capacity_provider_id","idempotency_key");
CREATE UNIQUE INDEX "idx_capacity_provider_identity_rotations_version" ON "capacity_provider_identity_rotations" USING btree ("capacity_provider_id","to_identity_version");
CREATE UNIQUE INDEX "idx_capacity_provider_lanes_provider_execution_name" ON "capacity_provider_lanes" USING btree ("capacity_provider_id","execution_provider_id","display_name");
CREATE INDEX "idx_capacity_provider_lanes_provider_status" ON "capacity_provider_lanes" USING btree ("capacity_provider_id","status","updated_at");
CREATE INDEX "idx_capacity_provider_proof_nonces_expiry" ON "capacity_provider_proof_nonces" USING btree ("expires_at");
CREATE INDEX "idx_capacity_provider_registration_rate_limits_expiry" ON "capacity_provider_registration_rate_limits" USING btree ("expires_at");
CREATE UNIQUE INDEX "idx_capacity_provider_registration_request_pending" ON "capacity_provider_registration_requests" USING btree ("team_id","capacity_provider_id","registration_key_generation");
CREATE UNIQUE INDEX "idx_capacity_provider_registration_request_proof" ON "capacity_provider_registration_requests" USING btree ("provider_fingerprint","proof_jti");
CREATE UNIQUE INDEX "idx_capacity_provider_registration_request_idempotency" ON "capacity_provider_registration_requests" USING btree ("team_id","idempotency_key");
CREATE INDEX "idx_capacity_provider_registration_requests_team" ON "capacity_provider_registration_requests" USING btree ("team_id","status","created_at");
CREATE INDEX "idx_capacity_provider_registration_requests_provider" ON "capacity_provider_registration_requests" USING btree ("capacity_provider_id","status","created_at");
CREATE UNIQUE INDEX "idx_capacity_provider_team_credentials_prefix" ON "capacity_provider_team_credentials" USING btree ("key_prefix");
CREATE UNIQUE INDEX "idx_capacity_provider_team_credentials_issue" ON "capacity_provider_team_credentials" USING btree ("membership_id","issue_idempotency_key");
CREATE UNIQUE INDEX "idx_capacity_provider_team_credentials_generation" ON "capacity_provider_team_credentials" USING btree ("membership_id","issuance_generation");
CREATE INDEX "idx_capacity_provider_team_credentials_membership" ON "capacity_provider_team_credentials" USING btree ("membership_id","status","created_at");
CREATE UNIQUE INDEX "idx_capacity_provider_team_memberships_unique" ON "capacity_provider_team_memberships" USING btree ("team_id","capacity_provider_id");
CREATE INDEX "idx_capacity_provider_team_memberships_team" ON "capacity_provider_team_memberships" USING btree ("team_id","status","updated_at");
CREATE INDEX "idx_capacity_provider_team_memberships_provider" ON "capacity_provider_team_memberships" USING btree ("capacity_provider_id","status","updated_at");
CREATE UNIQUE INDEX "idx_capacity_providers_fingerprint" ON "capacity_providers" USING btree ("fingerprint");
CREATE INDEX "idx_capacity_providers_status" ON "capacity_providers" USING btree ("status","updated_at");
CREATE UNIQUE INDEX "idx_capacity_reservation_counter_claim" ON "capacity_reservation_counter_claims" USING btree ("reservation_id","counter_id");
CREATE INDEX "idx_capacity_reservation_counter_counter" ON "capacity_reservation_counter_claims" USING btree ("counter_id","created_at");
CREATE UNIQUE INDEX "idx_capacity_reservations_idempotency" ON "capacity_reservations" USING btree ("team_id","idempotency_key");
CREATE INDEX "idx_capacity_reservations_project_workday_state" ON "capacity_reservations" USING btree ("project_id","work_day_id","state","created_at");
CREATE INDEX "idx_capacity_reservations_membership_state" ON "capacity_reservations" USING btree ("membership_id","state","created_at");
CREATE INDEX "idx_capacity_reservations_provider_state" ON "capacity_reservations" USING btree ("capacity_provider_id","state","created_at");
CREATE INDEX "idx_capacity_reservations_execution_provider_state" ON "capacity_reservations" USING btree ("execution_provider_id","state","created_at");
CREATE INDEX "idx_capacity_reservations_lane_state" ON "capacity_reservations" USING btree ("lane_id","state","created_at");
CREATE UNIQUE INDEX "idx_capacity_usage_actuals_idempotency" ON "capacity_usage_actuals" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "idx_capacity_usage_actuals_attempt_dimension" ON "capacity_usage_actuals" USING btree ("assignment_id","assignment_attempt","usage_dimension");
CREATE INDEX "idx_capacity_usage_actuals_project_signature" ON "capacity_usage_actuals" USING btree ("project_id","task_signature","created_at");
CREATE INDEX "idx_capacity_usage_actuals_project_signature_profile" ON "capacity_usage_actuals" USING btree ("project_id","task_signature","execution_profile_id","created_at");
CREATE INDEX "idx_capacity_usage_actuals_execution_provider" ON "capacity_usage_actuals" USING btree ("execution_provider_id","created_at");
CREATE INDEX "idx_capacity_usage_actuals_lane" ON "capacity_usage_actuals" USING btree ("lane_id","created_at");
CREATE UNIQUE INDEX "idx_capacity_workday_demands_idempotency" ON "capacity_workday_demands" USING btree ("team_id","idempotency_key");
CREATE UNIQUE INDEX "idx_capacity_workday_demands_assignment" ON "capacity_workday_demands" USING btree ("assignment_id");
CREATE UNIQUE INDEX "idx_capacity_workday_demands_claim" ON "capacity_workday_demands" USING btree ("claim_token");
CREATE INDEX "idx_capacity_workday_demands_ready" ON "capacity_workday_demands" USING btree ("team_id","status","available_at","priority");
CREATE INDEX "idx_capacity_workday_demands_run" ON "capacity_workday_demands" USING btree ("workday_run_id","project_id","status","created_at");
CREATE UNIQUE INDEX "idx_capacity_workday_events_run_index" ON "capacity_workday_events" USING btree ("run_id","event_index");
CREATE INDEX "idx_capacity_workday_events_project" ON "capacity_workday_events" USING btree ("project_id","created_at");
CREATE UNIQUE INDEX "idx_capacity_workday_participation_cycles_number" ON "capacity_workday_participation_cycles" USING btree ("workday_run_id","project_id","cycle_number");
CREATE INDEX "idx_capacity_workday_participation_cycles_status" ON "capacity_workday_participation_cycles" USING btree ("workday_run_id","status","project_id");
CREATE UNIQUE INDEX "idx_capacity_workday_participation_entries_agent" ON "capacity_workday_participation_entries" USING btree ("cycle_id","agent_id");
CREATE UNIQUE INDEX "idx_capacity_workday_participation_entries_demand" ON "capacity_workday_participation_entries" USING btree ("demand_id");
CREATE INDEX "idx_capacity_workday_participation_entries_status" ON "capacity_workday_participation_entries" USING btree ("workday_run_id","project_id","status","agent_id");
CREATE INDEX "idx_capacity_workday_runs_team_status" ON "capacity_workday_runs" USING btree ("team_id","status","updated_at");
CREATE INDEX "idx_capacity_workday_runs_provider" ON "capacity_workday_runs" USING btree ("capacity_provider_id","updated_at");
CREATE UNIQUE INDEX "idx_catalog_artifact_versions_item_version" ON "catalog_artifact_versions" USING btree ("item_id","version");
CREATE INDEX "idx_catalog_artifact_versions_team_kind" ON "catalog_artifact_versions" USING btree ("team_id","kind","published_at");
CREATE UNIQUE INDEX "idx_catalog_item_collaborators_subject_role" ON "catalog_item_collaborators" USING btree ("item_id","subject_type","subject_id","role");
CREATE UNIQUE INDEX "idx_catalog_items_team_kind_slug" ON "catalog_items" USING btree ("team_id","kind","slug");
CREATE INDEX "idx_catalog_items_team_kind" ON "catalog_items" USING btree ("team_id","kind","updated_at");
CREATE INDEX "idx_catalog_items_visibility_listing" ON "catalog_items" USING btree ("visibility","listing_enabled","updated_at");
CREATE INDEX "idx_client_encrypted_escrow_secret" ON "client_encrypted_escrow_records" USING btree ("secret_id","status");
CREATE INDEX "idx_client_encrypted_escrow_project" ON "client_encrypted_escrow_records" USING btree ("team_id","project_id","status");
CREATE UNIQUE INDEX "idx_commerce_buyer_stripe_customers_team" ON "commerce_buyer_stripe_customers" USING btree ("vendor_id","environment","buyer_team_id");
CREATE UNIQUE INDEX "idx_commerce_buyer_stripe_customers_user" ON "commerce_buyer_stripe_customers" USING btree ("vendor_id","environment","buyer_user_id");
CREATE UNIQUE INDEX "idx_commerce_buyer_stripe_customers_stripe" ON "commerce_buyer_stripe_customers" USING btree ("connected_account_id","stripe_customer_id");
CREATE INDEX "idx_commerce_capacity_inquiries_listing_status" ON "commerce_capacity_listing_inquiries" USING btree ("listing_id","status","updated_at");
CREATE INDEX "idx_commerce_capacity_inquiries_buyer_team" ON "commerce_capacity_listing_inquiries" USING btree ("buyer_team_id","status","updated_at");
CREATE INDEX "idx_commerce_capacity_inquiries_buyer_user" ON "commerce_capacity_listing_inquiries" USING btree ("buyer_user_id","status","updated_at");
CREATE INDEX "idx_commerce_capacity_inquiries_vendor_status" ON "commerce_capacity_listing_inquiries" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_capacity_inquiries_seller_status" ON "commerce_capacity_listing_inquiries" USING btree ("seller_team_id","status","updated_at");
CREATE INDEX "idx_commerce_capacity_inquiries_project" ON "commerce_capacity_listing_inquiries" USING btree ("related_project_id","status");
CREATE INDEX "idx_commerce_capacity_inquiries_workday" ON "commerce_capacity_listing_inquiries" USING btree ("related_workday_id","status");
CREATE UNIQUE INDEX "idx_commerce_capacity_listings_product" ON "commerce_capacity_listings" USING btree ("product_id");
CREATE INDEX "idx_commerce_capacity_listings_vendor_status" ON "commerce_capacity_listings" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_capacity_listings_seller_status" ON "commerce_capacity_listings" USING btree ("seller_team_id","status","updated_at");
CREATE INDEX "idx_commerce_capacity_listings_provider_status" ON "commerce_capacity_listings" USING btree ("capacity_provider_id","status");
CREATE INDEX "idx_commerce_capacity_listings_execution_provider_status" ON "commerce_capacity_listings" USING btree ("execution_provider_id","status");
CREATE INDEX "idx_commerce_capacity_listings_access_status" ON "commerce_capacity_listings" USING btree ("access_level","status","updated_at");
CREATE INDEX "idx_commerce_cart_items_cart_status" ON "commerce_cart_items" USING btree ("cart_id","status");
CREATE INDEX "idx_commerce_cart_items_vendor_status" ON "commerce_cart_items" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_cart_items_offer" ON "commerce_cart_items" USING btree ("offer_id");
CREATE INDEX "idx_commerce_cart_items_price" ON "commerce_cart_items" USING btree ("price_id");
CREATE INDEX "idx_commerce_carts_buyer_team_status" ON "commerce_carts" USING btree ("buyer_team_id","status","updated_at");
CREATE INDEX "idx_commerce_carts_buyer_user_status" ON "commerce_carts" USING btree ("buyer_user_id","status","updated_at");
CREATE INDEX "idx_commerce_checkouts_cart" ON "commerce_checkouts" USING btree ("cart_id");
CREATE INDEX "idx_commerce_checkouts_buyer_team_status" ON "commerce_checkouts" USING btree ("buyer_team_id","status","updated_at");
CREATE INDEX "idx_commerce_checkouts_buyer_user_status" ON "commerce_checkouts" USING btree ("buyer_user_id","status","updated_at");
CREATE INDEX "idx_commerce_contributions_product_effective" ON "commerce_contributions" USING btree ("product_id","effective_at");
CREATE INDEX "idx_commerce_contributions_version_effective" ON "commerce_contributions" USING btree ("product_version_id","effective_at");
CREATE INDEX "idx_commerce_contributions_contributor" ON "commerce_contributions" USING btree ("contributor_type","contributor_id");
CREATE INDEX "idx_commerce_entitlements_buyer_team_status" ON "commerce_entitlements" USING btree ("buyer_team_id","status","updated_at");
CREATE INDEX "idx_commerce_entitlements_buyer_user_status" ON "commerce_entitlements" USING btree ("buyer_user_id","status","updated_at");
CREATE INDEX "idx_commerce_entitlements_product_status" ON "commerce_entitlements" USING btree ("product_id","status");
CREATE INDEX "idx_commerce_entitlements_offer_status" ON "commerce_entitlements" USING btree ("offer_id","status");
CREATE INDEX "idx_commerce_entitlements_order" ON "commerce_entitlements" USING btree ("order_id");
CREATE INDEX "idx_commerce_entitlements_subscription" ON "commerce_entitlements" USING btree ("subscription_id");
CREATE INDEX "idx_commerce_entitlements_catalog_item" ON "commerce_entitlements" USING btree ("catalog_item_id");
CREATE INDEX "idx_commerce_fulfillment_events_order" ON "commerce_fulfillment_events" USING btree ("order_id","created_at");
CREATE INDEX "idx_commerce_fulfillment_events_entitlement" ON "commerce_fulfillment_events" USING btree ("entitlement_id","created_at");
CREATE INDEX "idx_commerce_fulfillment_events_vendor_status" ON "commerce_fulfillment_events" USING btree ("vendor_id","status","created_at");
CREATE INDEX "idx_commerce_fulfillment_events_product" ON "commerce_fulfillment_events" USING btree ("product_id","created_at");
CREATE INDEX "idx_commerce_governance_events_object" ON "commerce_governance_events" USING btree ("object_type","object_id","created_at");
CREATE INDEX "idx_commerce_governance_events_product" ON "commerce_governance_events" USING btree ("related_product_id","created_at");
CREATE INDEX "idx_commerce_governance_events_offer" ON "commerce_governance_events" USING btree ("related_offer_id","created_at");
CREATE INDEX "idx_commerce_governance_events_team" ON "commerce_governance_events" USING btree ("related_team_id","created_at");
CREATE INDEX "idx_commerce_governance_policies_product" ON "commerce_governance_policies" USING btree ("product_id","status");
CREATE INDEX "idx_commerce_governance_policies_team" ON "commerce_governance_policies" USING btree ("team_id","policy_kind","status");
CREATE INDEX "idx_commerce_offers_product_status" ON "commerce_offers" USING btree ("product_id","status","updated_at");
CREATE INDEX "idx_commerce_offers_vendor_status" ON "commerce_offers" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_offers_seller_status" ON "commerce_offers" USING btree ("seller_team_id","status","updated_at");
CREATE INDEX "idx_commerce_offers_active_price" ON "commerce_offers" USING btree ("active_price_id");
CREATE INDEX "idx_commerce_offers_stripe_product" ON "commerce_offers" USING btree ("stripe_product_id");
CREATE INDEX "idx_commerce_offers_stripe_status" ON "commerce_offers" USING btree ("stripe_product_status","updated_at");
CREATE INDEX "idx_commerce_order_items_order" ON "commerce_order_items" USING btree ("order_id");
CREATE INDEX "idx_commerce_order_items_product_status" ON "commerce_order_items" USING btree ("product_id","status");
CREATE INDEX "idx_commerce_order_items_offer_status" ON "commerce_order_items" USING btree ("offer_id","status");
CREATE INDEX "idx_commerce_order_items_entitlement" ON "commerce_order_items" USING btree ("entitlement_id");
CREATE INDEX "idx_commerce_orders_checkout" ON "commerce_orders" USING btree ("checkout_id");
CREATE INDEX "idx_commerce_orders_buyer_team_status" ON "commerce_orders" USING btree ("buyer_team_id","status","updated_at");
CREATE INDEX "idx_commerce_orders_buyer_user_status" ON "commerce_orders" USING btree ("buyer_user_id","status","updated_at");
CREATE INDEX "idx_commerce_orders_vendor_status" ON "commerce_orders" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_orders_stripe_payment_intent" ON "commerce_orders" USING btree ("stripe_payment_intent_id");
CREATE INDEX "idx_commerce_orders_stripe_subscription" ON "commerce_orders" USING btree ("stripe_subscription_id");
CREATE INDEX "idx_commerce_ownership_product_effective" ON "commerce_ownership_records" USING btree ("product_id","effective_at");
CREATE INDEX "idx_commerce_ownership_seller_effective" ON "commerce_ownership_records" USING btree ("seller_team_id","effective_at");
CREATE INDEX "idx_commerce_ownership_model_effective" ON "commerce_ownership_records" USING btree ("model","effective_at");
CREATE INDEX "idx_commerce_ownership_transfers_product" ON "commerce_ownership_transfers" USING btree ("product_id","effective_at");
CREATE INDEX "idx_commerce_ownership_transfers_product_status" ON "commerce_ownership_transfers" USING btree ("product_id","status","effective_at");
CREATE INDEX "idx_commerce_ownership_transfers_from_status" ON "commerce_ownership_transfers" USING btree ("from_ownership_record_id","status");
CREATE INDEX "idx_commerce_ownership_transfers_to_status" ON "commerce_ownership_transfers" USING btree ("to_ownership_record_id","status");
CREATE INDEX "idx_commerce_payment_groups_checkout" ON "commerce_payment_groups" USING btree ("checkout_id");
CREATE INDEX "idx_commerce_payment_groups_order" ON "commerce_payment_groups" USING btree ("order_id");
CREATE INDEX "idx_commerce_payment_groups_vendor_status" ON "commerce_payment_groups" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_payment_groups_payment_intent" ON "commerce_payment_groups" USING btree ("stripe_payment_intent_id");
CREATE INDEX "idx_commerce_payment_groups_subscription" ON "commerce_payment_groups" USING btree ("stripe_subscription_id");
CREATE UNIQUE INDEX "idx_commerce_prices_offer_version" ON "commerce_prices" USING btree ("offer_id","price_version");
CREATE INDEX "idx_commerce_prices_offer_status" ON "commerce_prices" USING btree ("offer_id","status");
CREATE INDEX "idx_commerce_prices_stripe_price" ON "commerce_prices" USING btree ("stripe_price_id");
CREATE INDEX "idx_commerce_prices_stripe_sync_status" ON "commerce_prices" USING btree ("stripe_sync_status","updated_at");
CREATE UNIQUE INDEX "idx_commerce_product_versions_product_version" ON "commerce_product_versions" USING btree ("product_id","version");
CREATE INDEX "idx_commerce_product_versions_product_status" ON "commerce_product_versions" USING btree ("product_id","status","created_at");
CREATE INDEX "idx_commerce_product_versions_catalog_artifact" ON "commerce_product_versions" USING btree ("catalog_artifact_version_id");
CREATE UNIQUE INDEX "idx_commerce_products_team_kind_slug" ON "commerce_products" USING btree ("seller_team_id","kind","slug");
CREATE INDEX "idx_commerce_products_vendor_status" ON "commerce_products" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_products_catalog_item" ON "commerce_products" USING btree ("catalog_item_id");
CREATE INDEX "idx_commerce_products_ownership_model" ON "commerce_products" USING btree ("ownership_model","updated_at");
CREATE UNIQUE INDEX "idx_commerce_refunds_stripe" ON "commerce_refunds" USING btree ("stripe_refund_id","stripe_connected_account_id");
CREATE UNIQUE INDEX "idx_commerce_refunds_idempotency" ON "commerce_refunds" USING btree ("idempotency_key");
CREATE INDEX "idx_commerce_refunds_order" ON "commerce_refunds" USING btree ("order_id","created_at");
CREATE INDEX "idx_commerce_refunds_vendor_status" ON "commerce_refunds" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_refunds_seller_status" ON "commerce_refunds" USING btree ("seller_team_id","status","updated_at");
CREATE UNIQUE INDEX "idx_commerce_service_contracts_request_quote" ON "commerce_service_contracts" USING btree ("request_id","quote_id");
CREATE INDEX "idx_commerce_service_contracts_vendor" ON "commerce_service_contracts" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_service_contracts_seller" ON "commerce_service_contracts" USING btree ("seller_team_id","status","updated_at");
CREATE INDEX "idx_commerce_service_contracts_buyer_team" ON "commerce_service_contracts" USING btree ("buyer_team_id","status","updated_at");
CREATE INDEX "idx_commerce_service_contracts_buyer_user" ON "commerce_service_contracts" USING btree ("buyer_user_id","status","updated_at");
CREATE INDEX "idx_commerce_service_contracts_order" ON "commerce_service_contracts" USING btree ("order_id");
CREATE INDEX "idx_commerce_service_contracts_entitlement" ON "commerce_service_contracts" USING btree ("entitlement_id");
CREATE INDEX "idx_commerce_service_contracts_project" ON "commerce_service_contracts" USING btree ("related_project_id");
CREATE INDEX "idx_commerce_service_contracts_workday" ON "commerce_service_contracts" USING btree ("related_workday_id");
CREATE INDEX "idx_commerce_service_events_request" ON "commerce_service_events" USING btree ("request_id","created_at");
CREATE INDEX "idx_commerce_service_events_quote" ON "commerce_service_events" USING btree ("quote_id","created_at");
CREATE INDEX "idx_commerce_service_events_contract" ON "commerce_service_events" USING btree ("contract_id","created_at");
CREATE INDEX "idx_commerce_service_events_type" ON "commerce_service_events" USING btree ("event_type","created_at");
CREATE UNIQUE INDEX "idx_commerce_service_quotes_request_version" ON "commerce_service_quotes" USING btree ("request_id","quote_version");
CREATE INDEX "idx_commerce_service_quotes_request" ON "commerce_service_quotes" USING btree ("request_id","status","updated_at");
CREATE INDEX "idx_commerce_service_quotes_vendor" ON "commerce_service_quotes" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_service_quotes_seller" ON "commerce_service_quotes" USING btree ("seller_team_id","status","updated_at");
CREATE INDEX "idx_commerce_service_requests_buyer_team" ON "commerce_service_requests" USING btree ("buyer_team_id","status","updated_at");
CREATE INDEX "idx_commerce_service_requests_buyer_user" ON "commerce_service_requests" USING btree ("buyer_user_id","status","updated_at");
CREATE INDEX "idx_commerce_service_requests_vendor" ON "commerce_service_requests" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_service_requests_seller" ON "commerce_service_requests" USING btree ("seller_team_id","status","updated_at");
CREATE INDEX "idx_commerce_service_requests_offer" ON "commerce_service_requests" USING btree ("offer_id","status");
CREATE INDEX "idx_commerce_service_requests_project" ON "commerce_service_requests" USING btree ("related_project_id","status");
CREATE INDEX "idx_commerce_service_requests_workday" ON "commerce_service_requests" USING btree ("related_workday_id","status");
CREATE INDEX "idx_commerce_stewards_product_role" ON "commerce_stewardship_assignments" USING btree ("product_id","role");
CREATE INDEX "idx_commerce_stewards_ownership_role" ON "commerce_stewardship_assignments" USING btree ("ownership_record_id","role");
CREATE INDEX "idx_commerce_stewards_assignee" ON "commerce_stewardship_assignments" USING btree ("assignee_type","assignee_id");
CREATE UNIQUE INDEX "idx_commerce_subscriptions_stripe" ON "commerce_subscriptions" USING btree ("stripe_subscription_id","stripe_connected_account_id");
CREATE INDEX "idx_commerce_subscriptions_buyer_team_status" ON "commerce_subscriptions" USING btree ("buyer_team_id","status","updated_at");
CREATE INDEX "idx_commerce_subscriptions_vendor_status" ON "commerce_subscriptions" USING btree ("vendor_id","status","updated_at");
CREATE INDEX "idx_commerce_subscriptions_offer_status" ON "commerce_subscriptions" USING btree ("offer_id","status");
CREATE INDEX "idx_commerce_succession_events_product" ON "commerce_succession_events" USING btree ("product_id","event_type","created_at");
CREATE INDEX "idx_commerce_succession_events_ownership" ON "commerce_succession_events" USING btree ("ownership_record_id","event_type");
CREATE INDEX "idx_commerce_succession_events_successor" ON "commerce_succession_events" USING btree ("successor_type","successor_id");
CREATE UNIQUE INDEX "idx_commerce_vendor_stripe_accounts_vendor_env" ON "commerce_vendor_stripe_accounts" USING btree ("vendor_id","environment");
CREATE UNIQUE INDEX "idx_commerce_vendor_stripe_accounts_stripe_env" ON "commerce_vendor_stripe_accounts" USING btree ("stripe_account_id","environment");
CREATE INDEX "idx_commerce_vendor_stripe_accounts_team_env" ON "commerce_vendor_stripe_accounts" USING btree ("team_id","environment");
CREATE INDEX "idx_commerce_vendor_stripe_accounts_status" ON "commerce_vendor_stripe_accounts" USING btree ("account_status","updated_at");
CREATE UNIQUE INDEX "idx_commerce_vendors_team_id" ON "commerce_vendors" USING btree ("team_id");
CREATE UNIQUE INDEX "idx_commerce_vendors_slug" ON "commerce_vendors" USING btree ("slug");
CREATE INDEX "idx_commerce_vendors_status" ON "commerce_vendors" USING btree ("status","updated_at");
CREATE INDEX "idx_commerce_vendors_trust_level" ON "commerce_vendors" USING btree ("trust_level","updated_at");
CREATE UNIQUE INDEX "idx_commerce_webhook_events_provider_event" ON "commerce_webhook_events" USING btree ("provider","environment","event_id");
CREATE INDEX "idx_commerce_webhook_events_status_received" ON "commerce_webhook_events" USING btree ("status","received_at");
CREATE INDEX "idx_commerce_webhook_events_connected_type" ON "commerce_webhook_events" USING btree ("connected_account_id","event_type","received_at");
CREATE INDEX "idx_commerce_webhook_events_order" ON "commerce_webhook_events" USING btree ("related_order_id");
CREATE INDEX "idx_commerce_webhook_events_subscription" ON "commerce_webhook_events" USING btree ("related_subscription_id");
CREATE UNIQUE INDEX "idx_commons_decisions_proposal" ON "commons_decisions" USING btree ("proposal_id");
CREATE INDEX "idx_commons_decisions_status" ON "commons_decisions" USING btree ("status","updated_at");
CREATE UNIQUE INDEX "idx_commons_delegations_active" ON "commons_delegations" USING btree ("from_participant_id","to_participant_id","scope","status");
CREATE INDEX "idx_commons_delegations_to" ON "commons_delegations" USING btree ("to_participant_id","status");
CREATE INDEX "idx_commons_governance_events_proposal" ON "commons_governance_events" USING btree ("proposal_id","created_at");
CREATE INDEX "idx_commons_governance_events_participant" ON "commons_governance_events" USING btree ("participant_id","created_at");
CREATE INDEX "idx_commons_governance_events_type" ON "commons_governance_events" USING btree ("event_type","created_at");
CREATE UNIQUE INDEX "idx_commons_participants_user" ON "commons_participants" USING btree ("user_id");
CREATE INDEX "idx_commons_participants_team_status" ON "commons_participants" USING btree ("team_id","status","updated_at");
CREATE UNIQUE INDEX "idx_commons_proposal_backings_once" ON "commons_proposal_backings" USING btree ("proposal_id","participant_id");
CREATE INDEX "idx_commons_proposal_backings_proposal" ON "commons_proposal_backings" USING btree ("proposal_id","created_at");
CREATE UNIQUE INDEX "idx_commons_proposal_votes_once" ON "commons_proposal_votes" USING btree ("proposal_id","participant_id");
CREATE INDEX "idx_commons_proposal_votes_proposal" ON "commons_proposal_votes" USING btree ("proposal_id","vote","updated_at");
CREATE INDEX "idx_commons_proposals_status" ON "commons_proposals" USING btree ("status","updated_at");
CREATE INDEX "idx_commons_proposals_participant" ON "commons_proposals" USING btree ("participant_id","status","updated_at");
CREATE INDEX "idx_commons_proposals_scope" ON "commons_proposals" USING btree ("scope","status","updated_at");
CREATE INDEX "idx_commons_questions_status" ON "commons_questions" USING btree ("status","updated_at");
CREATE INDEX "idx_commons_questions_participant" ON "commons_questions" USING btree ("participant_id","status","updated_at");
CREATE INDEX "idx_commons_weight_snapshots_participant" ON "commons_weight_snapshots" USING btree ("participant_id","created_at");
CREATE UNIQUE INDEX "idx_credit_conversion_profiles_profile_key" ON "credit_conversion_profiles" USING btree ("task_signature","execution_profile_id","execution_provider_kind","native_unit");
CREATE INDEX "idx_credit_conversion_profiles_kind_unit" ON "credit_conversion_profiles" USING btree ("execution_provider_kind","native_unit","updated_at");
CREATE INDEX "idx_cursor_state_updated" ON "cursor_state" USING btree ("updated_at");
CREATE UNIQUE INDEX "idx_decision_assignment_graphs_version" ON "decision_assignment_graphs" USING btree ("decision_id","version");
CREATE UNIQUE INDEX "idx_decision_assignment_graphs_one_active" ON "decision_assignment_graphs" USING btree ("decision_id") WHERE "decision_assignment_graphs"."active" = 1;
CREATE INDEX "idx_decision_assignment_graphs_decision" ON "decision_assignment_graphs" USING btree ("decision_id","active","version");
CREATE INDEX "idx_decision_execution_inputs_decision" ON "decision_execution_inputs" USING btree ("decision_id","status","created_at");
CREATE INDEX "idx_decision_execution_inputs_graph_node" ON "decision_execution_inputs" USING btree ("decision_id","work_graph_node_id","status");
CREATE UNIQUE INDEX "idx_decision_execution_inputs_graph_scope" ON "decision_execution_inputs" USING btree ("decision_id","work_graph_node_id","scope_hash") WHERE "decision_execution_inputs"."work_graph_node_id" IS NOT NULL;
CREATE INDEX "idx_decision_execution_inputs_project" ON "decision_execution_inputs" USING btree ("project_id","status","mode","created_at");
CREATE UNIQUE INDEX "idx_decision_planning_statuses_decision" ON "decision_planning_statuses" USING btree ("decision_id");
CREATE INDEX "idx_decision_planning_statuses_project" ON "decision_planning_statuses" USING btree ("project_id","execution_readiness","updated_at");
CREATE INDEX "idx_deliverable_contracts_decision" ON "deliverable_contracts" USING btree ("decision_id","status","deliverable_type");
CREATE INDEX "idx_deliverable_manifests_contract" ON "deliverable_manifests" USING btree ("deliverable_contract_id","submitted_at");
CREATE UNIQUE INDEX "idx_entitlements_project" ON "entitlements" USING btree ("project_id");
CREATE INDEX "idx_github_app_installations_team_status" ON "github_app_installation_records" USING btree ("team_id","status","updated_at");
CREATE UNIQUE INDEX "idx_github_app_installations_team_installation" ON "github_app_installation_records" USING btree ("team_id","installation_id");
CREATE INDEX "idx_github_app_token_issuance_project" ON "github_app_token_issuance_records" USING btree ("team_id","project_id","status","updated_at");
CREATE INDEX "idx_github_app_token_issuance_operation" ON "github_app_token_issuance_records" USING btree ("operation_id","status","expires_at");
CREATE INDEX "idx_github_app_token_issuance_assignment" ON "github_app_token_issuance_records" USING btree ("assignment_id","status","expires_at");
CREATE INDEX "idx_github_repository_grants_project" ON "github_repository_grants" USING btree ("team_id","project_id","status");
CREATE UNIQUE INDEX "idx_github_repository_grants_repository" ON "github_repository_grants" USING btree ("team_id","repository");
CREATE UNIQUE INDEX "idx_governance_decisions_proposal" ON "governance_decisions" USING btree ("proposal_id");
CREATE INDEX "idx_governance_decisions_project_status" ON "governance_decisions" USING btree ("project_id","status","updated_at");
CREATE INDEX "idx_governance_delegations_team_status" ON "governance_delegations" USING btree ("team_id","status");
CREATE INDEX "idx_governance_delegations_from" ON "governance_delegations" USING btree ("from_user_id","status");
CREATE INDEX "idx_governance_delegations_to" ON "governance_delegations" USING btree ("to_user_id","status");
CREATE INDEX "idx_governance_electorate_snapshots_proposal" ON "governance_electorate_snapshots" USING btree ("proposal_id","proposal_version");
CREATE INDEX "idx_governance_events_proposal" ON "governance_events" USING btree ("proposal_id","created_at");
CREATE INDEX "idx_governance_events_decision" ON "governance_events" USING btree ("decision_id","created_at");
CREATE INDEX "idx_governance_events_team" ON "governance_events" USING btree ("team_id","created_at");
CREATE INDEX "idx_governance_events_project" ON "governance_events" USING btree ("project_id","created_at");
CREATE UNIQUE INDEX "idx_governance_proposal_versions_unique" ON "governance_proposal_versions" USING btree ("proposal_id","version");
CREATE INDEX "idx_governance_proposal_versions_proposal" ON "governance_proposal_versions" USING btree ("proposal_id","created_at");
CREATE UNIQUE INDEX "idx_governance_proposal_votes_once" ON "governance_proposal_votes" USING btree ("proposal_id","proposal_version","user_id");
CREATE INDEX "idx_governance_proposal_votes_proposal" ON "governance_proposal_votes" USING btree ("proposal_id","proposal_version","vote");
CREATE INDEX "idx_governance_proposals_team_status" ON "governance_proposals" USING btree ("team_id","status","updated_at");
CREATE INDEX "idx_governance_proposals_project_status" ON "governance_proposals" USING btree ("project_id","status","updated_at");
CREATE INDEX "idx_governance_proposals_scope_status" ON "governance_proposals" USING btree ("scope","status","updated_at");
CREATE INDEX "idx_governance_proposals_content_slug" ON "governance_proposals" USING btree ("content_proposal_slug");
CREATE INDEX "idx_governance_vote_events_proposal" ON "governance_vote_events" USING btree ("proposal_id","proposal_version","created_at");
CREATE UNIQUE INDEX "idx_hub_launch_events_launch_seq" ON "hub_launch_events" USING btree ("launch_id","seq");
CREATE INDEX "idx_hub_launches_hub_created" ON "hub_launches" USING btree ("hub_id","created_at");
CREATE UNIQUE INDEX "idx_hub_repositories_hub_role" ON "hub_repositories" USING btree ("hub_id","role");
CREATE INDEX "idx_hub_workspace_links_hub" ON "hub_workspace_links" USING btree ("hub_id");
CREATE INDEX "idx_knowledge_packs_team_id" ON "knowledge_packs" USING btree ("team_id");
CREATE INDEX "idx_lease_state_status_expires" ON "lease_state" USING btree ("status","lease_expires_at");
CREATE INDEX "idx_lease_state_claimed_by" ON "lease_state" USING btree ("claimed_by","updated_at");
CREATE INDEX "idx_message_queue_claimable" ON "message_queue" USING btree ("status","available_at","priority");
CREATE INDEX "idx_message_queue_related" ON "message_queue" USING btree ("related_model","related_id","created_at");
CREATE INDEX "idx_notification_email_deliveries_due" ON "notification_email_deliveries" USING btree ("status","due_at");
CREATE INDEX "idx_notification_events_project" ON "notification_events" USING btree ("project_id","created_at");
CREATE INDEX "idx_planning_input_requests_decision" ON "planning_input_requests" USING btree ("decision_id","status","requested_at");
CREATE INDEX "idx_planning_input_requests_project" ON "planning_input_requests" USING btree ("project_id","status","requested_at");
CREATE UNIQUE INDEX "idx_platform_operation_events_seq" ON "platform_operation_events" USING btree ("operation_id","seq");
CREATE UNIQUE INDEX "idx_platform_operations_idempotency" ON "platform_operations" USING btree ("namespace","operation","idempotency_key");
CREATE INDEX "idx_platform_operations_runnable" ON "platform_operations" USING btree ("status","created_at");
CREATE UNIQUE INDEX "idx_platform_repository_claims_active" ON "platform_repository_claims" USING btree ("repository_key","runner_id");
CREATE INDEX "idx_platform_repository_claims_runner" ON "platform_repository_claims" USING btree ("runner_id","claim_state");
CREATE UNIQUE INDEX "idx_project_agent_classes_project_slug" ON "project_agent_classes" USING btree ("project_id","slug");
CREATE INDEX "idx_project_agent_classes_team_project" ON "project_agent_classes" USING btree ("team_id","project_id","status");
CREATE UNIQUE INDEX "idx_project_capability_grants_project_operation" ON "project_capability_grants" USING btree ("project_id","namespace","operation");
CREATE INDEX "idx_project_deployment_events_deployment_sequence" ON "project_deployment_events" USING btree ("deployment_id","sequence");
CREATE INDEX "idx_project_deployment_events_project_created" ON "project_deployment_events" USING btree ("project_id","created_at");
CREATE INDEX "idx_project_deployment_events_operation" ON "project_deployment_events" USING btree ("operation_id");
CREATE INDEX "idx_project_deployments_project_created" ON "project_deployments" USING btree ("project_id","created_at");
CREATE INDEX "idx_project_deployments_project_environment" ON "project_deployments" USING btree ("project_id","environment","created_at");
CREATE INDEX "idx_project_deployments_project_status" ON "project_deployments" USING btree ("project_id","status","updated_at");
CREATE INDEX "idx_project_deployments_operation" ON "project_deployments" USING btree ("platform_operation_id");
CREATE INDEX "idx_project_deployments_team_created" ON "project_deployments" USING btree ("team_id","created_at");
CREATE UNIQUE INDEX "idx_project_deployments_idempotency" ON "project_deployments" USING btree ("project_id","idempotency_key");
CREATE UNIQUE INDEX "idx_project_environments_project_environment" ON "project_environments" USING btree ("project_id","environment");
CREATE INDEX "idx_project_governance_policies_project" ON "project_governance_policies" USING btree ("project_id","active");
CREATE UNIQUE INDEX "idx_project_infrastructure_resource_unique" ON "project_infrastructure_resources" USING btree ("project_id","environment","provider","resource_kind","logical_name");
CREATE INDEX "idx_project_summary_snapshots_team_generated" ON "project_summary_snapshots" USING btree ("team_id","generated_at");
CREATE INDEX "idx_project_update_plans_hub" ON "project_update_plans" USING btree ("hub_id","created_at");
CREATE UNIQUE INDEX "idx_projects_team_slug" ON "projects" USING btree ("team_id","slug");
CREATE INDEX "idx_projects_team_id" ON "projects" USING btree ("team_id");
CREATE INDEX "idx_capacity_provider_availability_sessions_membership_status" ON "capacity_provider_availability_sessions" USING btree ("membership_id","status","expires_at");
CREATE INDEX "idx_capacity_provider_availability_sessions_provider_status" ON "capacity_provider_availability_sessions" USING btree ("capacity_provider_id","status","refreshed_at");
CREATE INDEX "idx_capacity_provider_availability_sessions_team_status" ON "capacity_provider_availability_sessions" USING btree ("team_id","status","refreshed_at");
CREATE INDEX "idx_provider_credential_sessions_team_host" ON "provider_credential_sessions" USING btree ("team_id","host_kind","host_id","status");
CREATE INDEX "idx_provider_credential_sessions_job" ON "provider_credential_sessions" USING btree ("job_id","status");
CREATE UNIQUE INDEX "idx_remote_job_events_job_seq" ON "remote_job_events" USING btree ("job_id","seq");
CREATE INDEX "idx_remote_jobs_project_status" ON "remote_jobs" USING btree ("project_id","status","created_at");
CREATE INDEX "idx_remote_jobs_project_idempotency" ON "remote_jobs" USING btree ("project_id","idempotency_key");
CREATE INDEX "idx_repository_hosts_team_provider" ON "repository_hosts" USING btree ("team_id","provider","status");
CREATE UNIQUE INDEX "idx_repository_hosts_team_provider_name" ON "repository_hosts" USING btree ("team_id","provider","name");
CREATE UNIQUE INDEX "idx_repository_hosts_platform_provider_name" ON "repository_hosts" USING btree ("provider","name");
CREATE UNIQUE INDEX "idx_research_workflows_idempotency" ON "research_workflows" USING btree ("project_id","idempotency_key");
CREATE INDEX "idx_research_workflows_question" ON "research_workflows" USING btree ("project_id","question_ref","status","updated_at");
CREATE INDEX "idx_runtime_records_type_lookup_updated" ON "runtime_records" USING btree ("record_type","lookup_key","updated_at");
CREATE INDEX "idx_runtime_records_type_status_updated" ON "runtime_records" USING btree ("record_type","status","updated_at");
CREATE INDEX "idx_secret_metadata_team_project" ON "secret_metadata_records" USING btree ("team_id","project_id","status");
CREATE INDEX "idx_secret_metadata_custody" ON "secret_metadata_records" USING btree ("custody_mode","status");
CREATE UNIQUE INDEX "idx_secret_metadata_team_name" ON "secret_metadata_records" USING btree ("team_id","project_id","name");
CREATE INDEX "idx_seed_runs_seed_created" ON "seed_runs" USING btree ("seed_name","created_at");
CREATE INDEX "idx_seed_runs_state_created" ON "seed_runs" USING btree ("state","created_at");
CREATE INDEX "idx_structured_agent_estimates_decision" ON "structured_agent_estimates" USING btree ("decision_id","status","created_at");
CREATE INDEX "idx_team_api_keys_prefix" ON "team_api_keys" USING btree ("key_prefix");
CREATE UNIQUE INDEX "idx_team_capacity_registration_keys_generation" ON "team_capacity_registration_keys" USING btree ("team_id","generation");
CREATE UNIQUE INDEX "idx_team_capacity_registration_keys_prefix" ON "team_capacity_registration_keys" USING btree ("key_prefix");
CREATE UNIQUE INDEX "idx_team_capacity_registration_keys_rotation" ON "team_capacity_registration_keys" USING btree ("team_id","rotation_idempotency_key");
CREATE INDEX "idx_team_capacity_registration_keys_current" ON "team_capacity_registration_keys" USING btree ("team_id","status","generation");
CREATE INDEX "idx_team_governance_policies_team_scope" ON "team_governance_policies" USING btree ("team_id","scope","active");
CREATE INDEX "idx_team_inbox_items_team_created" ON "team_inbox_items" USING btree ("team_id","created_at");
CREATE INDEX "idx_team_invites_team_status" ON "team_invites" USING btree ("team_id","status","created_at");
CREATE INDEX "idx_team_invites_token_prefix" ON "team_invites" USING btree ("token_prefix");
CREATE UNIQUE INDEX "idx_team_memberships_team_user" ON "team_memberships" USING btree ("team_id","user_id");
CREATE INDEX "idx_team_web_hosts_team_provider" ON "team_web_hosts" USING btree ("team_id","provider","status");
CREATE UNIQUE INDEX "idx_team_web_hosts_team_provider_name" ON "team_web_hosts" USING btree ("team_id","provider","name");
CREATE UNIQUE INDEX "idx_teams_name" ON "teams" USING btree ("name");
CREATE INDEX "idx_treedx_credential_issuance_assignment" ON "treedx_credential_issuance_records" USING btree ("assignment_id","status","expires_at");
CREATE INDEX "idx_treedx_credential_issuance_project" ON "treedx_credential_issuance_records" USING btree ("project_id","status","updated_at");
CREATE INDEX "idx_treedx_deployments_team_instance" ON "treedx_deployments" USING btree ("team_id","instance_id","created_at");
CREATE INDEX "idx_treedx_instances_team_status" ON "treedx_instances" USING btree ("team_id","status");
CREATE INDEX "idx_treedx_mirrors_team_instance" ON "treedx_mirrors" USING btree ("team_id","instance_id");
CREATE UNIQUE INDEX "idx_treedx_project_libraries_project" ON "treedx_project_libraries" USING btree ("project_id");
CREATE INDEX "idx_treedx_project_libraries_instance" ON "treedx_project_libraries" USING btree ("instance_id");
CREATE INDEX "idx_treedx_project_proxy_audit_project" ON "treedx_project_proxy_audit" USING btree ("project_id","created_at");
CREATE INDEX "idx_treedx_project_proxy_audit_assignment" ON "treedx_project_proxy_audit" USING btree ("assignment_id","created_at");
CREATE INDEX "idx_treedx_project_proxy_audit_result" ON "treedx_project_proxy_audit" USING btree ("project_id","result_status","created_at");
CREATE INDEX "idx_treedx_proxy_handles_assignment" ON "treedx_proxy_handles" USING btree ("assignment_id","status","expires_at");
CREATE INDEX "idx_treedx_proxy_handles_project" ON "treedx_proxy_handles" USING btree ("project_id","status","updated_at");
CREATE INDEX "idx_treedx_shares_team_scope" ON "treedx_shares" USING btree ("team_id","scope","status");
CREATE INDEX "idx_user_email_addresses_user" ON "user_email_addresses" USING btree ("user_id","status","is_primary");
CREATE UNIQUE INDEX "idx_user_email_addresses_normalized" ON "user_email_addresses" USING btree ("normalized_email");
CREATE UNIQUE INDEX "idx_user_identities_provider_subject" ON "user_identities" USING btree ("provider","provider_subject");
CREATE UNIQUE INDEX "idx_user_notifications_event" ON "user_notifications" USING btree ("user_id","event_id");
CREATE INDEX "idx_user_notifications_user" ON "user_notifications" USING btree ("user_id","read_at","created_at");
CREATE UNIQUE INDEX "idx_user_personal_themes_name" ON "user_personal_themes" USING btree ("user_id","normalized_name");
CREATE INDEX "idx_user_personal_themes_user" ON "user_personal_themes" USING btree ("user_id","updated_at");
CREATE UNIQUE INDEX "idx_user_role_bindings_user_role" ON "user_role_bindings" USING btree ("user_id","role_id");
CREATE UNIQUE INDEX "idx_users_username" ON "users" USING btree ("username");
CREATE INDEX "idx_web_sessions_user_id" ON "web_sessions" USING btree ("user_id");
CREATE INDEX "idx_workday_capacity_envelopes_run_status" ON "workday_capacity_envelopes" USING btree ("workday_run_id","status","id");
CREATE INDEX "idx_workday_capacity_envelopes_project_status" ON "workday_capacity_envelopes" USING btree ("project_id","status","created_at");
CREATE INDEX "idx_workday_capacity_envelopes_team_status" ON "workday_capacity_envelopes" USING btree ("team_id","status","created_at");
CREATE INDEX "idx_workflow_dispatch_records_operation" ON "workflow_dispatch_records" USING btree ("workflow_operation_id","status","created_at");
CREATE INDEX "idx_workflow_dispatch_records_platform" ON "workflow_dispatch_records" USING btree ("platform_operation_id");
CREATE INDEX "idx_workflow_operation_records_project" ON "workflow_operation_records" USING btree ("team_id","project_id","status");
CREATE UNIQUE INDEX "idx_workflow_operation_records_operation" ON "workflow_operation_records" USING btree ("team_id","id");
