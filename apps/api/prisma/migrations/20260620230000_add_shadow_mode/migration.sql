-- Shadow mode: regra em observação silenciosa (detecta e registra o incidente, mas não notifica).
-- Usado para calibrar thresholds antes de ligar o alerta via WebSocket.
ALTER TABLE `anomaly_rules` ADD COLUMN `shadow_mode` BOOLEAN NOT NULL DEFAULT false;

-- Marca o incidente nascido de uma regra em shadow mode (registrado, mas não notificado).
ALTER TABLE `incidents` ADD COLUMN `shadow` BOOLEAN NOT NULL DEFAULT false;
