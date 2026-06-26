-- CreateTable
CREATE TABLE `audit_scan_events` (
    `id` CHAR(36) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `partitions_total` INTEGER NOT NULL,
    `partitions_cached` INTEGER NOT NULL,
    `partitions_scanned` INTEGER NOT NULL,
    `s3_objects` INTEGER NOT NULL,
    `read_ms` INTEGER NOT NULL,

    INDEX `audit_scan_events_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
