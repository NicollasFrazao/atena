-- Alinha o código (PK) da regra ao que ela virou após o refino dos detectores:
--   r-integration-error      -> r-failure-spike            (agora "Pico de falha (vs baseline)", failure_spike)
-- A FK incidents.rule_id é ON UPDATE CASCADE, então as referências acompanham automaticamente.
UPDATE `anomaly_rules` SET `id` = 'r-failure-spike' WHERE `id` = 'r-integration-error';
