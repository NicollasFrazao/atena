-- CreateTable
CREATE TABLE `messages` (
    `id` CHAR(36) NOT NULL,
    `customer_id` VARCHAR(64) NOT NULL,
    `phone_e164` VARCHAR(20) NOT NULL,
    `phone_hash` VARCHAR(64) NOT NULL,
    `content_ref` VARCHAR(128) NULL,
    `provider` VARCHAR(64) NULL,
    `final_status` ENUM('delivered', 'failed', 'pending', 'unknown') NOT NULL,
    `requested_at` DATETIME(3) NOT NULL,
    `finalized_at` DATETIME(3) NULL,
    `s3_log_pointer` VARCHAR(512) NULL,
    `metadata` JSON NULL,

    INDEX `messages_phone_e164_idx`(`phone_e164`),
    INDEX `messages_customer_id_requested_at_idx`(`customer_id`, `requested_at` DESC),
    INDEX `messages_final_status_requested_at_idx`(`final_status`, `requested_at` DESC),
    INDEX `messages_provider_requested_at_idx`(`provider`, `requested_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_events` (
    `id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `event_type` ENUM('api_request', 'routing', 'provider_attempt', 'webhook_status', 'final') NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `payload` JSON NOT NULL,

    INDEX `message_events_message_id_occurred_at_idx`(`message_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incidents` (
    `id` CHAR(36) NOT NULL,
    `rule_id` VARCHAR(64) NOT NULL,
    `severity` ENUM('info', 'warning', 'critical') NOT NULL,
    `status` ENUM('detected', 'acknowledged', 'resolved', 'auto_resolved') NOT NULL,
    `dimension_type` ENUM('provider', 'customer', 'route', 'global') NOT NULL,
    `dimension_value` VARCHAR(128) NULL,
    `detection_window_start` DATETIME(3) NOT NULL,
    `detection_window_end` DATETIME(3) NOT NULL,
    `detection_payload` JSON NOT NULL,
    `detected_at` DATETIME(3) NOT NULL,
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by` VARCHAR(128) NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolved_by` VARCHAR(128) NULL,
    `action_category` ENUM('provider_recovered', 'provider_escalated', 'internal_escalated', 'false_positive', 'customer_communicated', 'monitoring_only', 'other') NULL,
    `action_description` TEXT NULL,
    `escalated_to` VARCHAR(128) NULL,
    `related_message_ids` JSON NULL,
    `tags` JSON NULL,

    INDEX `incidents_status_detected_at_idx`(`status`, `detected_at` DESC),
    INDEX `incidents_dimension_type_dimension_value_detected_at_idx`(`dimension_type`, `dimension_value`, `detected_at` DESC),
    INDEX `incidents_severity_detected_at_idx`(`severity`, `detected_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incident_activity` (
    `id` CHAR(36) NOT NULL,
    `incident_id` CHAR(36) NOT NULL,
    `user_id` VARCHAR(128) NULL,
    `activity_type` VARCHAR(32) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `payload` JSON NOT NULL,

    INDEX `incident_activity_incident_id_occurred_at_idx`(`incident_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `anomaly_rules` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `rule_type` ENUM('delivery_rate_drop', 'failure_spike', 'consistent_error', 'webhook_silence') NOT NULL,
    `dimension` ENUM('provider', 'customer', 'route', 'global') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `severity` ENUM('info', 'warning', 'critical') NOT NULL,
    `threshold` DECIMAL(12, 4) NOT NULL,
    `threshold_unit` VARCHAR(8) NOT NULL,
    `window_minutes` INTEGER NOT NULL,
    `updated_by` VARCHAR(128) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` VARCHAR(128) NOT NULL,
    `title` VARCHAR(200) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_activity` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `tags` JSON NULL,
    `incident_id` CHAR(36) NULL,

    INDEX `chat_sessions_user_id_last_activity_idx`(`user_id`, `last_activity` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `role` ENUM('user', 'assistant') NOT NULL,
    `content` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_messages_session_id_created_at_idx`(`session_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` CHAR(36) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `user_id` VARCHAR(128) NULL,
    `action` ENUM('tool_call', 'reveal_phone', 'reveal_content', 'incident_created', 'incident_ack', 'incident_resolve', 'session_start', 'export_report', 'rule_update') NOT NULL,
    `resource` VARCHAR(256) NOT NULL,
    `detail` TEXT NULL,
    `severity` ENUM('info', 'warning', 'pii', 'config') NOT NULL,
    `ip_address` VARCHAR(45) NULL,
    `metadata` JSON NULL,

    INDEX `audit_log_occurred_at_idx`(`occurred_at` DESC),
    INDEX `audit_log_user_id_occurred_at_idx`(`user_id`, `occurred_at` DESC),
    INDEX `audit_log_action_occurred_at_idx`(`action`, `occurred_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `message_events` ADD CONSTRAINT `message_events_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_rule_id_fkey` FOREIGN KEY (`rule_id`) REFERENCES `anomaly_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incident_activity` ADD CONSTRAINT `incident_activity_incident_id_fkey` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
