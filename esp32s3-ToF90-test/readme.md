# Nó de Sensoriamento IoT: ESP32-S3, EMQX Enterprise e MariaDB

Este repositório contém a implementação do nó de sensoriamento de distância para veículos aéreos não tripulados (drones). **Esta etapa do repositório foi desenvolvida com o objetivo principal de testar o funcionamento e a precisão do sensor ToF-90°, além de validar a estabilidade da conexão MQTT entre os microcontroladores e o broker EMQX Enterprise (local ou na nuvem AWS EC2).**

O sistema realiza a aquisição de dados do sensor Time-of-Flight (ToF), formata a carga em JSON e a transmite via protocolo MQTT para o broker **EMQX Enterprise**, que gerencia a autenticação, autorização (ACL) e a persistência em um banco **MariaDB**.

---

## 1. Arquitetura do Sistema

```
+------------------+         I2C          +------------------------------------+
|  Sensor ToF-90°  | <------------------> |              ESP32-S3              |
|  (VL53L0X / I2C) |  SDA: IO04 / SCL: IO05 | - Nó de Sensoriamento de Altitude  |
+------------------+                      | - WiFiMulti (Múltiplas Redes)      |
                                          | - Cliente MQTT PubSubClient        |
                                          | - Atualização OTA via HTTPUpdate   |
                                          +-----------------+------------------+
                                                            |
                                        MQTT (1883)         | Wi-Fi (2.4 GHz)
                       Sub: drone/cmd/ota  /  Pub: drone/#  | Pub: drone/ota/status
                                          v                 v
                               +-------------------------------------+
                               |           EMQX Enterprise           |
                               |    AWS EC2 / Nuvem: 3.134.108.165    |
                               +------------------+------------------+
                                        |                   |
                     Auth / ACL (MySQL) |                   | Rule Engine (INSERT)
                                        v                   v
                               +-----------------+  +-----------------------+
                               |     MariaDB     |  | Servidor Central      |
                               | (Banco de Dados)|  | (Painel Web OTA &     |
                               +-----------------+  |  Motor de IA: :5000)  |
                                                    +-----------------------+
```

---

## 2. Tecnologias e Bibliotecas

* **Microcontrolador:** ESP32-S3 DevKitC-1
* **Sensor de Distância:** M5Stack ToF-90° U196 (Controlador VL53L0X via I2C)
* **Framework de Desenvolvimento:** Arduino / PlatformIO
* **Bibliotecas C++:**
  * `WiFiMulti`: Conexão automática e redundante a múltiplos pontos de acesso Wi-Fi configurados.
  * `HTTPUpdate`, `WebServer` & `Update`: Atualização de firmware Over-The-Air (OTA) puxada do servidor central via MQTT (`HTTPUpdate`) e suporte a status HTTP local.
  * `m5stack/M5UnitUnified`: Gerenciamento do barramento de sensores M5Stack.
  * `m5stack/M5Unit-TOF`: Driver para leitura de distância do sensor VL53L0X.
  * `knolleary/PubSubClient`: Conectividade MQTT com reconexão resiliente.
  * `bblanchon/ArduinoJson`: Serialização e montagem do payload JSON de telemetria.
  * `adafruit/Adafruit NeoPixel`: Controle do LED RGB onboard (WS2812B no GPIO 48) para diagnósticos de estado.

---

## 3. Modelo de Dados (MariaDB)

Execute o script SQL abaixo para estruturar o esquema do banco de dados `iot_db`, a tabela de telemetria, as tabelas de controle de acesso (Autenticação/ACL) e os privilégios do usuário de serviço:

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
VALUES ('esp32s3_tof90', SHA2('SUA_SENHA_MQTT', 256))
ON DUPLICATE KEY UPDATE password_hash = SHA2('SUA_SENHA_MQTT', 256);

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
CREATE USER IF NOT EXISTS 'emqx_user'@'127.0.0.1' IDENTIFIED BY 'SUA_SENHA_DB';
GRANT ALL PRIVILEGES ON iot_db.* TO 'emqx_user'@'127.0.0.1';
FLUSH PRIVILEGES;
```

---

## 4. Configuração do EMQX Enterprise

### 4.1. Regra de Processamento e Persistência (Rule Engine)
A regra processa os pacotes publicados no tópico `drone/sensor/tof90`, realizando o *casting* do tipo booleano para numérico (`1` ou `0`):

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
  * **Query SQL:** `SELECT password_hash FROM users WHERE username = ${username} LIMIT 1`
* **Autorização (ACL -> MySQL):**
  * **Query SQL:** `SELECT action, permission, topic FROM acl WHERE username = ${username}`

---

## 5. Mapeamento de Estados do LED RGB (GPIO 48)

O LED WS2812B integrado no ESP32-S3 fornece feedback visual sobre o estado da aplicação durante os testes de validação:

| Cor | Estado da Aplicação |
| --- | --- |
| **Azul** | Inicialização de periféricos, varredura WiFiMulti ou **gravação OTA em andamento**. |
| **Verde** | Operação nominal: Conectado ao Wi-Fi/MQTT ou **gravação OTA concluída com sucesso**. |
| **Vermelho** | Falha de hardware (I2C), falha de conexão Wi-Fi/MQTT ou **erro durante gravação OTA**. |

---

## 6. Atualização de Firmware Over-The-Air (OTA)

O microcontrolador suporta atualização de firmware sem fio (Over-The-Air) operando em dois modos complementares:

### 6.1. Orquestração Centralizada via Servidor Web e MQTT (Método Principal)
1. **Inscrição de Comandos:** O ESP32-S3 fica inscrito no tópico `drone/cmd/ota`.
2. **Disparo pelo Servidor:** Ao clicar em **"INICIAR ATUALIZAÇÃO DE FIRMWARE (OTA)"** no Painel Web (`http://<IP_SERVIDOR>:5000`), o servidor despacha a URL do binário (`http://<IP_SERVIDOR>:5000/firmware.bin`).
3. **Pull e Gravação Nativa:** O ESP32 suspende temporariamente as leituras do sensor ToF, conecta via HTTP e grava o novo binário em blocos usando a biblioteca nativa `HTTPUpdate`.
4. **Feedback de Progresso:** Durante o download, o ESP32 publica seu progresso percentual (0 a 100%) em tempo real no tópico `drone/ota/status` e sinaliza através do LED WS2812B (Azul).
5. **Reboot Automático:** Concluída a validação da partição Flash (`ota_0` / `ota_1`), o dispositivo reinicia automaticamente já na nova versão com o LED em Verde.

### 6.2. Servidor HTTP Local para Diagnóstico e Fallback (Porta 80)
Para testes pontuais de bancada via rede local:
* `GET /status`: Retorna JSON com status de conectividade, memória Heap disponível, tempo de atividade e prontidão OTA.
* `POST /update`: Endpoint multipart/form-data (campo `update`) para transmissão direta do arquivo binário `.bin`.

### 6.3. Tabela de Partições e Geração do Binário
Configurada no `platformio.ini` via `board_build.partitions = default_8MB.csv`, alocando slots duplos de 3.264 KB (`ota_0` e `ota_1`).

Para compilar o binário para distribuição OTA:
```bash
pio run
```
O arquivo gerado estará em `.pio/build/esp32-s3-devkitc-1/firmware.bin`, que é automaticamente lido e servido pelo Painel Web.

---

## 7. Instruções para Compilação e Gravação

### 7.1. Configuração de Credenciais com `secrets.h` e `WiFiMulti`

Por segurança, as credenciais de Wi-Fi e MQTT foram desacopladas do código fonte e são mantidas em um arquivo ignorado pelo Git:

```bash
# A partir da pasta esp32s3-ToF90-test
cp include/secrets.example.h include/secrets.h
```

No arquivo `include/secrets.h`, configure os múltiplos SSIDs suportados e o endpoint do broker MQTT (AWS EC2 ou IP local):

```cpp
#pragma once

// Redes Wi-Fi suportadas via WiFiMulti
#define WIFI_SSID_1       "SuaRedePrincipal"
#define WIFI_PASSWORD_1   "SenhaPrincipal"

#define WIFI_SSID_2       "HotspotMovel"
#define WIFI_PASSWORD_2   "SenhaHotspot"

// Broker MQTT (AWS EC2 ou Local)
#define MQTT_BROKER       "3.134.108.165"
#define MQTT_PORT         1883
#define MQTT_USER         "esp32s3_tof90"
#define MQTT_PASS         "SuaSenhaMQTT"
```

### 7.2. Compilação e Gravação

Via PlatformIO CLI:

```bash
# Compilar e gravar o firmware via cabo USB (primeira vez)
pio run -t upload

# Abrir o monitor serial
pio device monitor
```

> [!NOTE]
> Ao gravar via porta USB-JTAG integrada do ESP32-S3, pressione brevemente o botão físico de **RST/EN** na placa após o término do upload para inicializar o boot da nova imagem.

### 7.3. Verificação no Banco de Dados

Para confirmar a correta gravação das medições de teste no banco MariaDB:

```bash
mariadb -u emqx_user -pSUA_SENHA_DB -h 3.134.108.165 iot_db -e "SELECT id, device_id, distance_mm, distance_cm, is_valid, created_at FROM sensor_tof ORDER BY id DESC LIMIT 10;"
```
