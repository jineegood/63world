-- 육삼빌딩의 세계 DB 초안 v4 (MySQL 8 기준)
-- 운영 버전에서는 비밀번호를 평문으로 저장하지 말고 bcrypt/argon2 해시로 저장하세요.
-- 단, 현재 브라우저 데모는 교실 테스트 편의를 위해 관리자가 비밀번호를 볼 수 있도록 localStorage에 평문 저장합니다.

CREATE DATABASE IF NOT EXISTS yuksam_world DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE yuksam_world;

CREATE TABLE users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  login_id VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  password_hint_demo VARCHAR(255) NULL,
  role ENUM('student','admin') NOT NULL DEFAULT 'student',
  display_name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE characters (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(30) NOT NULL UNIQUE,
  class_code ENUM('warrior','mage','priest') NOT NULL,
  spec_code VARCHAR(30) NULL,
  level INT NOT NULL DEFAULT 1,
  exp INT NOT NULL DEFAULT 0,
  hp INT NOT NULL DEFAULT 10,
  max_hp INT NOT NULL DEFAULT 10,
  gold INT NOT NULL DEFAULT 0,
  building_currency INT NOT NULL DEFAULT 0,
  current_map VARCHAR(50) NOT NULL DEFAULT 'town',
  pos_x INT NOT NULL DEFAULT 1190,
  pos_y INT NOT NULL DEFAULT 1060,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_char_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE character_appearance (
  character_id BIGINT UNSIGNED PRIMARY KEY,
  shirt_color VARCHAR(20) NOT NULL,
  pants_color VARCHAR(20) NOT NULL,
  hair_color VARCHAR(20) NOT NULL,
  accessory VARCHAR(30) NOT NULL DEFAULT 'none',
  CONSTRAINT fk_appearance_character FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE zones (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  zone_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  min_level INT NOT NULL DEFAULT 1,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE question_workbooks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  workbook_code VARCHAR(80) NOT NULL UNIQUE,
  zone_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  subject VARCHAR(50) NULL,
  ai_prompt TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_workbook_zone FOREIGN KEY (zone_id) REFERENCES zones(id),
  CONSTRAINT fk_workbook_admin FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE questions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  workbook_id BIGINT UNSIGNED NOT NULL,
  question_text TEXT NOT NULL,
  answer_text VARCHAR(255) NOT NULL,
  difficulty INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_question_workbook FOREIGN KEY (workbook_id) REFERENCES question_workbooks(id) ON DELETE CASCADE
);

CREATE TABLE monsters (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  zone_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  hp INT NOT NULL DEFAULT 3,
  reward_exp INT NOT NULL DEFAULT 1,
  reward_gold INT NOT NULL DEFAULT 2,
  attack_power INT NOT NULL DEFAULT 1,
  respawn_seconds INT NOT NULL DEFAULT 30,
  speed DECIMAL(5,2) NOT NULL DEFAULT 0.85,
  asset_key VARCHAR(80) NOT NULL DEFAULT 'mushroom',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_monster_zone FOREIGN KEY (zone_id) REFERENCES zones(id)
);

CREATE TABLE items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  item_code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  slot_code ENUM('weapon','head','armor','accessory') NOT NULL,
  class_only ENUM('warrior','mage','priest') NULL,
  price_gold INT NULL,
  price_building INT NULL,
  description TEXT NULL,
  stats_json JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE character_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  character_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  is_equipped TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_character_item_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT fk_character_item_item FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE battle_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  character_id BIGINT UNSIGNED NOT NULL,
  monster_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  is_correct TINYINT(1) NOT NULL,
  damage INT NOT NULL DEFAULT 0,
  exp_gained INT NOT NULL DEFAULT 0,
  gold_gained INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_battle_char FOREIGN KEY (character_id) REFERENCES characters(id),
  CONSTRAINT fk_battle_monster FOREIGN KEY (monster_id) REFERENCES monsters(id),
  CONSTRAINT fk_battle_question FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE quest_progress (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  character_id BIGINT UNSIGNED NOT NULL,
  quest_code VARCHAR(50) NOT NULL,
  status ENUM('accepted','ready','completed') NOT NULL DEFAULT 'accepted',
  progress INT NOT NULL DEFAULT 0,
  target_count INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_character_quest (character_id, quest_code),
  CONSTRAINT fk_quest_char FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

INSERT INTO zones (zone_code, name, min_level, description)
VALUES ('silent_forest', '고요한 숲', 1, 'Lv.1 학생이 처음 입장하는 문제 사냥터')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO monsters (zone_id, name, hp, reward_exp, reward_gold, attack_power, respawn_seconds, speed, asset_key)
SELECT id, '버섯돌이', 4, 1, 2, 1, 30, 0.92, 'mushroom'
FROM zones WHERE zone_code = 'silent_forest';
