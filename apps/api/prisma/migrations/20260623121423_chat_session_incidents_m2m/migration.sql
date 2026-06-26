/*
  Warnings:

  - You are about to drop the column `incident_id` on the `chat_sessions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `chat_sessions` DROP COLUMN `incident_id`;

-- CreateTable
CREATE TABLE `chat_session_incidents` (
    `session_id` CHAR(36) NOT NULL,
    `incident_id` CHAR(36) NOT NULL,
    `linked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_session_incidents_incident_id_idx`(`incident_id`),
    PRIMARY KEY (`session_id`, `incident_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `chat_session_incidents` ADD CONSTRAINT `chat_session_incidents_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
