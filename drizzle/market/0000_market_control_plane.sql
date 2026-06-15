CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "agent_pool_registrations" (
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

CREATE TABLE "agent_pool_scale_decisions" (
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

CREATE TABLE "agent_pools" (
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

CREATE TABLE "capacity_grants" (
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

CREATE TABLE "capacity_ledger_entries" (
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

CREATE TABLE "capacity_provider_api_keys" (
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

CREATE TABLE "capacity_provider_deployments" (
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

CREATE TABLE "capacity_provider_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"host_id" text NOT NULL,
	"role" text NOT NULL,
	"required" integer DEFAULT 1 NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "capacity_provider_lanes" (
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

CREATE TABLE "capacity_provider_registrations" (
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

CREATE TABLE "capacity_providers" (
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

CREATE TABLE "capacity_reservations" (
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

CREATE TABLE "capacity_routing_decisions" (
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
	"capacity_provider_lane_id" text,
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
	"updated_at" text NOT NULL
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

CREATE TABLE "execution_provider_native_limits" (
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

CREATE TABLE "execution_provider_observations" (
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

CREATE TABLE "execution_providers" (
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

CREATE TABLE "graph_runs" (
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

CREATE TABLE "native_usage_observations" (
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

CREATE TABLE "priority_overrides" (
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

CREATE TABLE "priority_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"work_day_id" text,
	"snapshot_json" text NOT NULL,
	"metadata_json" text NOT NULL,
	"generated_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
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

CREATE TABLE "project_workday_summaries" (
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

CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"work_day_id" text NOT NULL,
	"kind" text NOT NULL,
	"body_json" text NOT NULL,
	"rendered_ref" text,
	"sent_at" text,
	"created_at" text NOT NULL
);

CREATE TABLE "repository_claims" (
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

CREATE TABLE "runner_scale_decisions" (
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

CREATE TABLE "scale_decisions" (
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

CREATE TABLE "subscribers" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "task_credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"work_day_id" text NOT NULL,
	"task_id" text,
	"phase" text NOT NULL,
	"credits" real NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "task_estimate_profiles" (
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

CREATE TABLE "task_estimates" (
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

CREATE TABLE "task_events" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"data_json" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "task_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"output_json" text NOT NULL,
	"output_ref" text,
	"created_at" text NOT NULL
);

CREATE TABLE "task_usage_actuals" (
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

CREATE TABLE "tasks" (
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

CREATE TABLE "work_days" (
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

CREATE TABLE "work_policies" (
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

CREATE TABLE "workday_manager_leases" (
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

CREATE TABLE "workday_requests" (
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

CREATE TABLE "worker_runners" (
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

CREATE INDEX "idx_agent_pool_registrations_pool_heartbeat" ON "agent_pool_registrations" USING btree ("pool_id","heartbeat_at");
CREATE INDEX "idx_agent_pool_scale_decisions_pool_created" ON "agent_pool_scale_decisions" USING btree ("pool_id","created_at");
CREATE UNIQUE INDEX "idx_agent_pools_project_environment_name" ON "agent_pools" USING btree ("project_id","environment","name");
CREATE INDEX "idx_api_tokens_user_id" ON "api_tokens" USING btree ("user_id");
CREATE INDEX "idx_api_tokens_prefix" ON "api_tokens" USING btree ("token_prefix");
CREATE INDEX "idx_approval_requests_team_state" ON "approval_requests" USING btree ("team_id","state","created_at");
CREATE INDEX "idx_approval_requests_project_workday" ON "approval_requests" USING btree ("project_id","work_day_id","state","created_at");
CREATE INDEX "idx_audit_events_target" ON "audit_events" USING btree ("target_type","target_id");
CREATE INDEX "idx_auth_sessions_user_id" ON "auth_sessions" USING btree ("user_id");
CREATE INDEX "idx_better_auth_account_userId" ON "better_auth_account" USING btree ("userId");
CREATE UNIQUE INDEX "idx_better_auth_account_provider_account" ON "better_auth_account" USING btree ("providerId","accountId");
CREATE INDEX "idx_better_auth_session_token" ON "better_auth_session" USING btree ("token");
CREATE INDEX "idx_better_auth_session_userId" ON "better_auth_session" USING btree ("userId");
CREATE UNIQUE INDEX "idx_better_auth_user_username" ON "better_auth_user" USING btree ("username");
CREATE INDEX "idx_better_auth_verification_identifier" ON "better_auth_verification" USING btree ("identifier");
CREATE INDEX "idx_capacity_grants_team_project" ON "capacity_grants" USING btree ("team_id","project_id","state");
CREATE INDEX "idx_capacity_grants_provider_lane" ON "capacity_grants" USING btree ("capacity_provider_id","lane_id","state");
CREATE INDEX "idx_capacity_ledger_project_workday_created" ON "capacity_ledger_entries" USING btree ("project_id","work_day_id","created_at");
CREATE INDEX "idx_capacity_provider_api_keys_provider_status" ON "capacity_provider_api_keys" USING btree ("capacity_provider_id","status","created_at");
CREATE INDEX "idx_capacity_provider_api_keys_prefix" ON "capacity_provider_api_keys" USING btree ("key_prefix");
CREATE INDEX "idx_capacity_provider_deployments_provider_created" ON "capacity_provider_deployments" USING btree ("capacity_provider_id","created_at");
CREATE UNIQUE INDEX "idx_capacity_provider_hosts_unique" ON "capacity_provider_hosts" USING btree ("capacity_provider_id","host_id","role");
CREATE INDEX "idx_capacity_provider_lanes_provider" ON "capacity_provider_lanes" USING btree ("capacity_provider_id","business_model","scarcity_level");
CREATE INDEX "idx_capacity_provider_registrations_provider_seen" ON "capacity_provider_registrations" USING btree ("capacity_provider_id","last_seen_at");
CREATE INDEX "idx_capacity_providers_team_status" ON "capacity_providers" USING btree ("team_id","status","provider");
CREATE INDEX "idx_capacity_reservations_project_workday_state" ON "capacity_reservations" USING btree ("project_id","work_day_id","state","created_at");
CREATE INDEX "idx_capacity_reservations_provider_state" ON "capacity_reservations" USING btree ("capacity_provider_id","lane_id","state");
CREATE INDEX "idx_capacity_reservations_execution_provider_state" ON "capacity_reservations" USING btree ("execution_provider_id","state","created_at");
CREATE INDEX "idx_capacity_routing_decisions_project_workday" ON "capacity_routing_decisions" USING btree ("project_id","work_day_id","created_at");
CREATE UNIQUE INDEX "idx_catalog_artifact_versions_item_version" ON "catalog_artifact_versions" USING btree ("item_id","version");
CREATE INDEX "idx_catalog_artifact_versions_team_kind" ON "catalog_artifact_versions" USING btree ("team_id","kind","published_at");
CREATE UNIQUE INDEX "idx_catalog_item_collaborators_subject_role" ON "catalog_item_collaborators" USING btree ("item_id","subject_type","subject_id","role");
CREATE UNIQUE INDEX "idx_catalog_items_team_kind_slug" ON "catalog_items" USING btree ("team_id","kind","slug");
CREATE INDEX "idx_catalog_items_team_kind" ON "catalog_items" USING btree ("team_id","kind","updated_at");
CREATE INDEX "idx_catalog_items_visibility_listing" ON "catalog_items" USING btree ("visibility","listing_enabled","updated_at");
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
CREATE INDEX "idx_commerce_capacity_listings_lane_status" ON "commerce_capacity_listings" USING btree ("capacity_provider_lane_id","status");
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
CREATE UNIQUE INDEX "idx_entitlements_project" ON "entitlements" USING btree ("project_id");
CREATE INDEX "idx_execution_provider_native_limits_provider_scope" ON "execution_provider_native_limits" USING btree ("execution_provider_id","scope","native_unit");
CREATE INDEX "idx_execution_provider_observations_provider_observed" ON "execution_provider_observations" USING btree ("execution_provider_id","observed_at");
CREATE INDEX "idx_execution_providers_team_status" ON "execution_providers" USING btree ("team_id","status","kind");
CREATE INDEX "idx_execution_providers_capacity_provider" ON "execution_providers" USING btree ("capacity_provider_id","status");
CREATE UNIQUE INDEX "idx_hub_launch_events_launch_seq" ON "hub_launch_events" USING btree ("launch_id","seq");
CREATE INDEX "idx_hub_launches_hub_created" ON "hub_launches" USING btree ("hub_id","created_at");
CREATE UNIQUE INDEX "idx_hub_repositories_hub_role" ON "hub_repositories" USING btree ("hub_id","role");
CREATE INDEX "idx_hub_workspace_links_hub" ON "hub_workspace_links" USING btree ("hub_id");
CREATE INDEX "idx_knowledge_packs_team_id" ON "knowledge_packs" USING btree ("team_id");
CREATE INDEX "idx_lease_state_status_expires" ON "lease_state" USING btree ("status","lease_expires_at");
CREATE INDEX "idx_lease_state_claimed_by" ON "lease_state" USING btree ("claimed_by","updated_at");
CREATE INDEX "idx_message_queue_claimable" ON "message_queue" USING btree ("status","available_at","priority");
CREATE INDEX "idx_message_queue_related" ON "message_queue" USING btree ("related_model","related_id","created_at");
CREATE INDEX "idx_native_usage_observations_profile" ON "native_usage_observations" USING btree ("project_id","task_signature","execution_profile_id","created_at");
CREATE INDEX "idx_native_usage_observations_provider" ON "native_usage_observations" USING btree ("execution_provider_id","created_at");
CREATE UNIQUE INDEX "idx_platform_operation_events_seq" ON "platform_operation_events" USING btree ("operation_id","seq");
CREATE UNIQUE INDEX "idx_platform_operations_idempotency" ON "platform_operations" USING btree ("namespace","operation","idempotency_key");
CREATE INDEX "idx_platform_operations_runnable" ON "platform_operations" USING btree ("status","created_at");
CREATE UNIQUE INDEX "idx_platform_repository_claims_active" ON "platform_repository_claims" USING btree ("repository_key","runner_id");
CREATE INDEX "idx_platform_repository_claims_runner" ON "platform_repository_claims" USING btree ("runner_id","claim_state");
CREATE INDEX "idx_priority_overrides_project_priority" ON "priority_overrides" USING btree ("project_id","priority","updated_at");
CREATE INDEX "idx_priority_snapshots_project_generated" ON "priority_snapshots" USING btree ("project_id","generated_at");
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
CREATE UNIQUE INDEX "idx_project_infrastructure_resource_unique" ON "project_infrastructure_resources" USING btree ("project_id","environment","provider","resource_kind","logical_name");
CREATE INDEX "idx_project_summary_snapshots_team_generated" ON "project_summary_snapshots" USING btree ("team_id","generated_at");
CREATE INDEX "idx_project_update_plans_hub" ON "project_update_plans" USING btree ("hub_id","created_at");
CREATE INDEX "idx_project_workday_summaries_project_environment_created" ON "project_workday_summaries" USING btree ("project_id","environment","created_at");
CREATE UNIQUE INDEX "idx_projects_team_slug" ON "projects" USING btree ("team_id","slug");
CREATE INDEX "idx_projects_team_id" ON "projects" USING btree ("team_id");
CREATE INDEX "idx_provider_credential_sessions_team_host" ON "provider_credential_sessions" USING btree ("team_id","host_kind","host_id","status");
CREATE INDEX "idx_provider_credential_sessions_job" ON "provider_credential_sessions" USING btree ("job_id","status");
CREATE UNIQUE INDEX "idx_remote_job_events_job_seq" ON "remote_job_events" USING btree ("job_id","seq");
CREATE INDEX "idx_remote_jobs_project_status" ON "remote_jobs" USING btree ("project_id","status","created_at");
CREATE INDEX "idx_remote_jobs_project_idempotency" ON "remote_jobs" USING btree ("project_id","idempotency_key");
CREATE UNIQUE INDEX "idx_repository_claims_runner_repo" ON "repository_claims" USING btree ("project_id","repository_id","runner_id");
CREATE INDEX "idx_repository_claims_repo_state" ON "repository_claims" USING btree ("project_id","repository_id","claim_state","updated_at");
CREATE INDEX "idx_repository_hosts_team_provider" ON "repository_hosts" USING btree ("team_id","provider","status");
CREATE UNIQUE INDEX "idx_repository_hosts_team_provider_name" ON "repository_hosts" USING btree ("team_id","provider","name");
CREATE UNIQUE INDEX "idx_repository_hosts_platform_provider_name" ON "repository_hosts" USING btree ("provider","name");
CREATE INDEX "idx_runner_scale_decisions_project_workday" ON "runner_scale_decisions" USING btree ("project_id","environment","work_day_id","created_at");
CREATE INDEX "idx_runtime_records_type_lookup_updated" ON "runtime_records" USING btree ("record_type","lookup_key","updated_at");
CREATE INDEX "idx_runtime_records_type_status_updated" ON "runtime_records" USING btree ("record_type","status","updated_at");
CREATE INDEX "idx_scale_decisions_project_environment_pool_created" ON "scale_decisions" USING btree ("project_id","environment","pool_name","created_at");
CREATE INDEX "idx_seed_runs_seed_created" ON "seed_runs" USING btree ("seed_name","created_at");
CREATE INDEX "idx_seed_runs_state_created" ON "seed_runs" USING btree ("state","created_at");
CREATE INDEX "idx_task_credit_ledger_work_day_created" ON "task_credit_ledger" USING btree ("work_day_id","created_at");
CREATE INDEX "idx_task_estimates_project_signature" ON "task_estimates" USING btree ("project_id","task_signature","created_at");
CREATE INDEX "idx_task_estimates_project_signature_profile" ON "task_estimates" USING btree ("project_id","task_signature","execution_profile_id","created_at");
CREATE UNIQUE INDEX "idx_task_events_seq" ON "task_events" USING btree ("task_id","seq");
CREATE INDEX "idx_task_usage_actuals_project_signature" ON "task_usage_actuals" USING btree ("project_id","task_signature","created_at");
CREATE INDEX "idx_task_usage_actuals_project_signature_profile" ON "task_usage_actuals" USING btree ("project_id","task_signature","execution_profile_id","created_at");
CREATE INDEX "idx_task_usage_actuals_execution_provider" ON "task_usage_actuals" USING btree ("execution_provider_id","created_at");
CREATE INDEX "idx_tasks_runnable" ON "tasks" USING btree ("state","priority","available_at");
CREATE INDEX "idx_tasks_work_day_agent" ON "tasks" USING btree ("work_day_id","agent_id","created_at");
CREATE INDEX "idx_team_api_keys_prefix" ON "team_api_keys" USING btree ("key_prefix");
CREATE INDEX "idx_team_inbox_items_team_created" ON "team_inbox_items" USING btree ("team_id","created_at");
CREATE INDEX "idx_team_invites_team_status" ON "team_invites" USING btree ("team_id","status","created_at");
CREATE INDEX "idx_team_invites_token_prefix" ON "team_invites" USING btree ("token_prefix");
CREATE UNIQUE INDEX "idx_team_memberships_team_user" ON "team_memberships" USING btree ("team_id","user_id");
CREATE INDEX "idx_team_web_hosts_team_provider" ON "team_web_hosts" USING btree ("team_id","provider","status");
CREATE UNIQUE INDEX "idx_team_web_hosts_team_provider_name" ON "team_web_hosts" USING btree ("team_id","provider","name");
CREATE UNIQUE INDEX "idx_teams_name" ON "teams" USING btree ("name");
CREATE INDEX "idx_treedx_deployments_team_instance" ON "treedx_deployments" USING btree ("team_id","instance_id","created_at");
CREATE INDEX "idx_treedx_instances_team_status" ON "treedx_instances" USING btree ("team_id","status");
CREATE INDEX "idx_treedx_mirrors_team_instance" ON "treedx_mirrors" USING btree ("team_id","instance_id");
CREATE UNIQUE INDEX "idx_treedx_project_libraries_project" ON "treedx_project_libraries" USING btree ("project_id");
CREATE INDEX "idx_treedx_project_libraries_instance" ON "treedx_project_libraries" USING btree ("instance_id");
CREATE INDEX "idx_treedx_shares_team_scope" ON "treedx_shares" USING btree ("team_id","scope","status");
CREATE INDEX "idx_user_email_addresses_user" ON "user_email_addresses" USING btree ("user_id","status","is_primary");
CREATE UNIQUE INDEX "idx_user_email_addresses_normalized" ON "user_email_addresses" USING btree ("normalized_email");
CREATE UNIQUE INDEX "idx_user_identities_provider_subject" ON "user_identities" USING btree ("provider","provider_subject");
CREATE UNIQUE INDEX "idx_user_role_bindings_user_role" ON "user_role_bindings" USING btree ("user_id","role_id");
CREATE UNIQUE INDEX "idx_users_username" ON "users" USING btree ("username");
CREATE INDEX "idx_web_sessions_user_id" ON "web_sessions" USING btree ("user_id");
CREATE INDEX "idx_workday_manager_leases_active" ON "workday_manager_leases" USING btree ("project_id","environment","state","heartbeat_at");
CREATE INDEX "idx_workday_requests_project_environment_state" ON "workday_requests" USING btree ("project_id","environment","state","created_at");
CREATE UNIQUE INDEX "idx_worker_runners_identity" ON "worker_runners" USING btree ("project_id","environment","runner_id");
CREATE INDEX "idx_worker_runners_state_capacity" ON "worker_runners" USING btree ("project_id","environment","state","available_capacity");
