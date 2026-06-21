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
CREATE TABLE IF NOT EXISTS `subscribers` (
	`email` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
