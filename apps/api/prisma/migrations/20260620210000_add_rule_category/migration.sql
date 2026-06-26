-- Categoria de erro alvo do detector `consistent_error` (ex.: 'invalid_number', 'policy_block').
-- NULL = comportamento anterior (categoria de falha dominante).
ALTER TABLE `anomaly_rules` ADD COLUMN `category` VARCHAR(32) NULL;
