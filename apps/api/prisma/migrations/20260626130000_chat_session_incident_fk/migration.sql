-- Integridade referencial faltante no join m2m sessão↔incidente: a migration original
-- (20260623121423) criou `chat_session_incidents` com FK só para `session_id`, deixando
-- `incident_id` sem FK (permitia vínculos órfãos). Adiciona o FK para `incidents(id)`.
-- AddForeignKey
ALTER TABLE `chat_session_incidents` ADD CONSTRAINT `chat_session_incidents_incident_id_fkey` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
