-- Rename da entidade de entrega: related_message_ids -> related_shipping_ids (envio).
-- Os ids são dos ENVIOS impactados por um incidente (md5(campaign_id||phone)); o conteúdo é o mesmo.
ALTER TABLE `incidents` RENAME COLUMN `related_message_ids` TO `related_shipping_ids`;
