-- Alinha os códigos (PK) das regras ao que elas viraram após o refino dos detectores:
--   r-integration-error      -> r-failure-spike            (agora "Pico de falha (vs baseline)", failure_spike)
--   r-webhook-silence-sinch  -> r-webhook-silence-provider (agora "por provedor", não sinch-específico)
-- A FK incidents.rule_id é ON UPDATE CASCADE, então as referências acompanham automaticamente.
UPDATE `anomaly_rules` SET `id` = 'r-failure-spike' WHERE `id` = 'r-integration-error';
UPDATE `anomaly_rules` SET `id` = 'r-webhook-silence-provider' WHERE `id` = 'r-webhook-silence-sinch';
