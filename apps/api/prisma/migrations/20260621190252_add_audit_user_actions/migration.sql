-- AlterTable
ALTER TABLE `audit_log` MODIFY `action` ENUM('tool_call', 'reveal_phone', 'reveal_content', 'incident_created', 'incident_ack', 'incident_resolve', 'session_start', 'export_report', 'rule_update', 'user_role_update', 'user_status_update') NOT NULL;
