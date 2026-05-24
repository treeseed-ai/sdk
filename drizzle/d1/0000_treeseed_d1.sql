CREATE TABLE IF NOT EXISTS `contact_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`organization` text,
	`contact_type` text,
	`subject` text,
	`message` text NOT NULL,
	`user_agent` text,
	`created_at` text NOT NULL,
	`ip_hash` text
);

CREATE INDEX IF NOT EXISTS `idx_contact_submissions_created_at` ON `contact_submissions` (`created_at`);
CREATE INDEX IF NOT EXISTS `idx_contact_submissions_email` ON `contact_submissions` (`email`);
CREATE TABLE IF NOT EXISTS `runtime_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_type` text NOT NULL,
	`record_key` text NOT NULL,
	`lookup_key` text,
	`secondary_key` text,
	`status` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text,
	`payload_json` text NOT NULL,
	`meta_json` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_runtime_records_type_lookup_updated` ON `runtime_records` (`record_type`,`lookup_key`,`updated_at`);
CREATE INDEX IF NOT EXISTS `idx_runtime_records_type_status_updated` ON `runtime_records` (`record_type`,`status`,`updated_at`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_runtime_records_type_record_key` ON `runtime_records` (`record_type`,`record_key`);
CREATE TABLE IF NOT EXISTS `subscribers` (
	`email` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
