-- Dropa o hot store de entrega (messages/message_events): o dado de entrega passa a vir do S3
-- sob demanda (AuditQueryService via DuckDB). MySQL fica só com dado da aplicação (D4).

-- DropForeignKey
ALTER TABLE `message_events` DROP FOREIGN KEY `message_events_message_id_fkey`;

-- DropTable
DROP TABLE `message_events`;

-- DropTable
DROP TABLE `messages`;
