-- Additive migration. No accounts or staff assignments are created here.
CREATE TABLE IF NOT EXISTS aetherius_admin_permissions (
  role VARCHAR(32) NOT NULL,
  permission VARCHAR(64) NOT NULL,
  PRIMARY KEY (role, permission)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS aetherius_admin_operations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id INT NOT NULL,
  character_id INT NULL,
  target_account_id INT NULL,
  target_character_id INT NULL,
  action VARCHAR(64) NOT NULL,
  reason VARCHAR(240) NOT NULL,
  is_sensitive TINYINT NOT NULL DEFAULT 0,
  payload_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'accepted',
  result_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY request_actor (account_id, request_id),
  KEY history (is_sensitive, id),
  KEY target_history (target_character_id, id)
) ENGINE=InnoDB;

-- INSERT IGNORE preserves deliberate removals only if this seed is run once.
-- The migration runner records this migration and never reapplies it.
INSERT IGNORE INTO aetherius_admin_permissions (role, permission) VALUES
('moderator','panel.open'),('moderator','players.view'),('moderator','players.teleport'),('moderator','players.kick'),('moderator','logs.view'),
('admin','panel.open'),('admin','players.view'),('admin','players.teleport'),('admin','players.kick'),('admin','logs.view'),('admin','inventory.grant'),('admin','economy.adjust'),('admin','identity.reveal'),('admin','characters.permakill'),('admin','logs.view.security'),
('owner','panel.open'),('owner','players.view'),('owner','players.teleport'),('owner','players.kick'),('owner','logs.view'),('owner','inventory.grant'),('owner','economy.adjust'),('owner','identity.reveal'),('owner','characters.permakill'),('owner','logs.view.security');
