# Nó de Sensoriamento IoT: ESP32-S3, EMQX Enterprise e MariaDB

Este repositório contém a implementação do nó de sensoriamento de distância para veículos aéreos não tripulados (drones). **Esta etapa do repositório foi desenvolvida com o objetivo principal de testar o funcionamento e a precisão do sensor ToF-90°, além de validar a estabilidade da conexão MQTT entre os microcontroladores e o broker EMQX Enterprise.**

O sistema realiza a aquisição de dados do sensor Time-of-Flight (ToF), formata a carga em JSON e a transmite via protocolo MQTT para um broker **EMQX Enterprise**, que gerencia a autenticação, autorização (ACL) e a persistência em um banco **MariaDB**.

---

## 1. Arquitetura do Sistema

```
+------------------+         I2C          +-------------------+
|  Sensor ToF-90°  | <------------------> |     ESP32-S3      |
|  (VL53L0X / I2C) |  SDA: IO04 / SCL: IO05 |  (Cliente MQTT)   |
+------------------+                      +-------------------+
                                                    |
                                      MQTT (1883)   | WiFi 802.11 b/g/n
                                                    v
                                          +-------------------+
                                          |  EMQX Enterprise  |
                                          |   Broker v5.8.0   |
                                          +-------------------+
                                            |               |
                         Auth / ACL (MySQL) |               | Rule Engine (INSERT)
                                            v               v
                                          +-------------------+
                                          |      MariaDB      |
                                          |  (Database Server)|
                                          +-------------------+

```

---

## 2. Tecnologias e Bibliotecas

* **Microcontrolador:** ESP32-S3 DevKit
* **Sensor de Distância:** M5Stack ToF-90° U196 (Controlador VL53L0X via I2C)
* **Framework de Desenvolvimento:** Arduino / PlatformIO
* **Bibliotecas C++:**
* `m5stack/M5UnitUnified`: Gerenciamento do barramento de sensores M5Stack.
* `m5stack/M5Unit-TOF`: Driver para leitura de distância do sensor VL53L0X.
* `knolleary/PubSubClient`: Conectividade MQTT.
* `bblanchon/ArduinoJson`: Serialização e montagem do payload JSON.
* `adafruit/Adafruit NeoPixel`: Controle do LED RGB onboard (WS2812B no GPIO 48) para diagnósticos de estado.



---

## 3. Modelo de Dados (MariaDB)

Execute o script SQL abaixo para estruturar o esquema do banco de dados `iot_db`, a tabela de telemetria, as tabelas de controle de acesso (Autenticação/ACL) e os privilégios do usuário de serviço.

```sql
CREATE DATABASE IF NOT EXISTS iot_db;
USE iot_db;

-- Tabela de persistência de telemetria do sensor
CREATE TABLE IF NOT EXISTS sensor_tof (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    sensor VARCHAR(50) NOT NULL,
    distance_mm INT,
    distance_cm FLOAT,
    is_valid BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de usuários para Autenticação MQTT
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_superuser BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inserção das credenciais do cliente com hash SHA-256
INSERT INTO users (username, password_hash) 
VALUES ('esp32s3_tof90', SHA2('Heitor2006#', 256))
ON DUPLICATE KEY UPDATE password_hash = SHA2('Heitor2006#', 256);

-- Tabela de Autorização (ACL)
CREATE TABLE IF NOT EXISTS acl (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    permission ENUM('allow', 'deny') NOT NULL,
    action ENUM('publish', 'subscribe', 'all') NOT NULL,
    topic VARCHAR(255) NOT NULL
);

-- Permissão restrita de publicação no tópico de telemetria
INSERT INTO acl (username, permission, action, topic) 
VALUES ('esp32s3_tof90', 'allow', 'publish', 'drone/sensor/tof90');

-- Criação do usuário de conexão do broker ao banco de dados
CREATE USER IF NOT EXISTS 'emqx_user'@'127.0.0.1' IDENTIFIED BY 'emqx_pass123';
GRANT ALL PRIVILEGES ON iot_db.* TO 'emqx_user'@'127.0.0.1';
FLUSH PRIVILEGES;

```

---

## 4. Configuração do EMQX Enterprise

### 4.1. Regra de Processamento e Persistência (Rule Engine)

A regra processa os pacotes publicados no tópico `drone/sensor/tof90`, realizando o *casting* do tipo booleano para numérico (`1` ou `0`), de forma a manter compatibilidade com o driver de prepared statements do MySQL do Erlang.

* **SQL da Regra:**
```sql
SELECT
  payload.device_id as device_id,
  payload.sensor as sensor,
  payload.distance_mm as distance_mm,
  payload.distance_cm as distance_cm,
  case when payload.valid = true then 1 else 0 end as is_valid
FROM "drone/sensor/tof90"

```


* **Ação de Inserção (SQL Template):**
```sql
INSERT INTO sensor_tof (device_id, sensor, distance_mm, distance_cm, is_valid)
VALUES (${device_id}, ${sensor}, ${distance_mm}, ${distance_cm}, ${is_valid});

```



### 4.2. Autenticação e Autorização (Access Control)

* **Autenticação (Password-Based -> MySQL):**
* **Hash Algorithm:** `sha256`
* **Query SQL:**
```sql
SELECT password_hash FROM users WHERE username = ${username} LIMIT 1

```




* **Autorização (ACL -> MySQL):**
* **Query SQL:**
```sql
SELECT action, permission, topic FROM acl WHERE username = ${username}

```





---

## 5. Mapeamento de Estados do LED RGB (GPIO 48)

O LED WS2812B integrado no ESP32-S3 fornece feedback visual sobre o estado da aplicação durante os testes de validação:

| Cor | Estado da Aplicação |
| --- | --- |
| **Azul** | Inicialização de periféricos, scan I2C ou tentativa de conexão Wi-Fi. |
| **Verde** | Operação nominal: Conectado ao Wi-Fi/MQTT e publicando mensagens com sucesso. |
| **Vermelho** | Falha de hardware (I2C), falha na conexão Wi-Fi ou rejeição de autenticação/ACL pelo broker. |

---

## 6. Instruções para Compilação e Verificação

### 6.1. Configuração de Permissões de Porta no Linux

Antes de realizar o upload do firmware, assegure-se de que o usuário possui permissão de escrita no nó `/dev/ttyACM0`:

```bash
sudo chmod 666 /dev/ttyACM0
sudo usermod -a -G uucp $USER

```

### 6.2. Compilação e Gravação

Via PlatformIO CLI:

```bash
# Compilar e gravar o firmware
pio run -t upload

# Abrir o monitor serial
pio device monitor

```

### 6.3. Verificação no Banco de Dados

Para confirmar a correta gravação das medições de teste no banco MariaDB:

```bash
mariadb -u emqx_user -pemqx_pass123 -h 127.0.0.1 iot_db -e "SELECT id, device_id, distance_mm, distance_cm, is_valid, created_at FROM sensor_tof ORDER BY id DESC LIMIT 10;"

```