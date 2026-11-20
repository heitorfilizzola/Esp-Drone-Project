![ESP-Drone Poster](assets/esp_drone_poster.png)

# ESP-Drone: Sistema de Telemetria e Monitoramento de Altitude com ESP32-S2 e ToF 90°

Sistema integrado de controle, sensoriamento e telemetria IoT para veículos aéreos não tripulados (drones). O projeto utiliza a plataforma de código aberto **ESP-Drone** baseada no SoC **ESP32-S2**, integrado ao sensor de distância **Unit Mini ToF 90°** para medição precisa de altitude, broker **EMQX** para distribuição de telemetria em tempo real e um **aplicativo mobile** dedicado para monitoramento conciso dos voos.

---

## 📌 Visão Geral do Projeto

O objetivo principal deste projeto é integrar sensoriamento de altitude em tempo real a uma plataforma de drone com ESP32-S2, permitindo estabilização de voo mais precisa e disponibilizando dados de telemetria tanto para ferramentas avançadas de pilotagem em PC quanto para um aplicativo móvel voltado ao acompanhamento visual e conciso da operação.

A arquitetura do sistema divide-se em três pilares principais:
1. **Controle e Sensoriamento no Drone (Hardware):** Leitura de altitude pelo sensor Time-of-Flight (Mini ToF 90°) via I2C, fusão com a malha de estabilização do firmware ESP-Drone e transmissão simultânea via protocolo de controle (CRTP) e mensagens MQTT.
2. **Infraestrutura e Estação de Solo:** Comunicação direta com software de pilotagem (Crazyflie Client / QGroundControl) e despacho de telemetria para o broker MQTT **EMQX**.
3. **Apresentação e Telemetria Móvel:** Aplicativo mobile conectado ao EMQX que assina os tópicos de telemetria e exibe painéis intuitivos de altitude, histórico e status de conectividade.

---

## 🏗️ Arquitetura do Sistema

```
+-------------------------------------------------------------------------------+
|                                CAMADA DE HARDWARE                             |
|                                                                               |
|  +--------------------+      I2C      +---------------------------------+     |
|  |   Mini TOF 90°     | ------------> |       ESP32-S2 (ESP-Drone)      |     |
|  |  (Sensor Altura)   |               |                                 |     |
|  +--------------------+               | - Leitura do TOF (Altitude)     |     |
|                                       | - Estabilização / Firmware      |     |
|                                       | - Cliente MQTT & Protocolo CRTP |     |
|                                       +---------------------------------+     |
+---------------------------------------/----------------\----------------------+
                                        /                  \
              Comandos / Telemetria   /                    \ MQTT Publish
                   (CRTP via Wi-Fi/UDP)                      \ (drone/sensor/tof90)
                                     /                      \
+-----------------------------------|------------------------|------------------+
|                                  v                         v                  |
|                        +-------------------+     +-------------------+        |
|                        | Software de       |     |       EMQX        |        |
|                        | Controle de Voo   |     |   (MQTT Broker)   |        |
|                        | (Crazyflie Client |     |                   |        |
|                        | / QGroundControl) |     +---------|---------+        |
|                        +-------------------+               |                  |
|                                                            |                  |
|                                  ESTAÇÃO PC                |                  |
+------------------------------------------------------------|------------------+
                                                             |
                                               Wi-Fi / MQTT  | Sub: drone/#
                                                             v
+-------------------------------------------------------------------------------+
|                              CAMADA DE APRESENTAÇÃO                           |
|                                                                               |
|                   +---------------------------------------+                   |
|                   |           Aplicativo Mobile           |                   |
|                   |                                       |                   |
|                   | - Dashboard de Telemetria (ToF 90°)   |                   |
|                   | - Altitude Máxima e Mínima em Tempo   |                   |
|                   | - Gerenciador de Gravação OTA (Wi-Fi) |                   |
|                   | - IA Copilot de Estabilidade de Voo   |                   |
|                   +---------------------------------------+                   |
+-------------------------------------------------------------------------------+
```

---
## ⚡ Diagrama Elétrico Geral do Drone

```
       +-----------------------+
       |   Bateria LiPo 1S     |
       |  (3.7V / 300-600mAh)  |
       +-----------+-----------+
                   |
                   +------------------------------------+
                   |                                    |
                   v                                    v
       +-----------------------+            +-----------------------+
       |     Regulador LDO     |            |  Drivers / MOSFETs    |
       |     (3.7V -> 3.3V)    |            |   Motores do Drone    |
       +-----------+-----------+            +-----------+-----------+
                   |                                    |
                   | (3.3V Estabilizado)                | (Alimentação Direta)
                   v                                    v
      +-------------------------+              +------------------+
      |  ESP32-S2 (MCU Core)    |              | Motores M1 - M4  |
      +------------+------------+              +------------------+
                   |
            Barramento I2C
                   |
                   v
      +-------------------------+
      |     Mini TOF 90°        |
      |   (Medição Altitude)    |
      +-------------------------+
```

---

## ⚡ Esquema Elétrico do Circuito
```

                       +-----------------------------------+
                       |        ESP32-S2 (ESP-Drone)       |
                       |                                   |
                       |  [3V3]  [GND]   [GPIO8]  [GPIO9]  |
                       +---|-------|--------|--------|-----+
                           |       |        |        |
                           |       |       SDA      SCL
                           |       |        |        |
 +-------------------+     |       |        |        |
 |   Mini TOF 90°    |     |       |        |        |
 |                   |     |       |        |        |
 |  [VCC]  [GND]     | <---+       |        |        |
 |    |      |       |             |        |        |
 |    +------+-------|-------------+        |        |
 |                   |                      |        |
 |  [SDA]------------|----------------------+        |
 |  [SCL]------------|-------------------------------+
 |                   |
 +-------------------+
```


## 🔍 Detalhamento das Camadas

### 1. Camada de Hardware (Onboard)
* **ESP32-S2 (ESP-Drone):** Responsável por executar os algoritmos de controle de atitude, estabilização de voo, geração de sinais PWM para os motores e gerenciamento das tarefas de rede. Implementa simultaneamente uma pilha UDP para o protocolo CRTP e um cliente MQTT leve.
* **Sensor Unit Mini ToF 90°:** Módulo sensor de distância óptico por tempo de voo com amplo campo de visão (FOV de 90°). Conectado ao ESP32-S2 via barramento **I2C**, mede continuamente a distância do drone em relação ao solo/obstáculos com alta precisão e baixa sensibilidade a variações de iluminação ambiente.

### 2. Estação PC e Mensageria
* **Software de Controle de Voo:** Interface de comando de baixo nível e sintonia (Crazyflie Client ou QGroundControl) comunicando via **CRTP (Crazy RealTime Protocol)** sobre Wi-Fi/UDP. Permite controle manual por joystick, calibração de PID e diagnóstico operacional direto.
* **Broker EMQX:** Servidor de mensagens MQTT escalável e de baixa latência responsável por receber os pacotes de telemetria publicados pelo drone (`drone/sensor/tof90`) e encaminhá-los de maneira desacoplada aos clientes inscritos.

### 3. Camada de Apresentação (Aplicativo Mobile)
* **Aplicativo Mobile:** Desenvolvido para fornecer uma experiência visual simplificada e objetiva ao operador em solo.
  * Conecta-se ao broker EMQX e assina o tópico de telemetria global (`drone/telemetry/#`).
  * Exibe em tempo real a altitude atual em centímetros/metros e extremos de voo (máx/mín).
  * Apresenta gráficos de linha com a evolução temporal da altitude.
  * **Atualização Over-The-Air (OTA):** Envio direto de binários `.bin` compilados para o microcontrolador via Wi-Fi, com monitoramento de progresso e validação de status.
  * **IA Copilot & Telemetria:** Algoritmo embarcado de detecção de anomalias aerodinâmicas e relatório diagnóstico de estabilidade de voo.
  * Sinaliza o estado da conexão MQTT e eventuais alertas de perda de telemetria.

---

## 📡 Especificação de Comunicação MQTT

### Tópicos
| Tópico | Direção | Protocolo | Descrição |
| :--- | :--- | :--- | :--- |
| `drone/sensor/tof90` | Drone ➔ EMQX | MQTT (TCP 1883) | Publicação periódica das leituras do sensor ToF-90° |
| `drone/#` | EMQX ➔ App Mobile | MQTT sobre WebSocket (8083) | Tópico curinga (wildcard) para subscrição de toda a telemetria do drone |

### Exemplo de Payload (JSON)
```json
{
  "device_id": "esp32s3_tof90",
  "sensor": "U196_ToF90",
  "distance_mm": 275,
  "distance_cm": 27.5,
  "valid": true,
  "timestamp": 458920
}
```

---

## 🛠️ Tecnologias e Ferramentas

* **Hardware:**
  * Drone: ESP-Drone baseado no SoC Espressif ESP32-S2 / ESP32-S3
  * Sensor: M5Stack Unit Mini ToF 90° U196 (Comunicação I2C)
* **Firmware / Redes:**
  * ESP-IDF / Arduino / PlatformIO
  * Protocolo CRTP (Crazy RealTime Protocol via UDP)
  * Cliente MQTT (PubSubClient)
* **Serviços & Broker:**
  * EMQX Broker (MQTT v3.1.1 / v5.0, TCP 1883 e WebSocket 8083)
* **Estação de Controle & Apresentação:**
  * Crazyflie Python Client / QGroundControl
  * [DroneTelemetryApp](DroneTelemetryApp/) (Dashboard Mobile React Native / Expo)

---

## 📁 Estrutura do Repositório

```text
.
├── DroneTelemetryApp/     # Aplicativo mobile React Native (Expo) para telemetria e diagnóstico IA
├── esp32s3-ToF90-test/    # Firmware do drone (ESP32-S3) com ToF-90, MQTT e cliente HTTPUpdate OTA
├── server/                # Servidor Web e Central de Atualizações Over-The-Air (OTA) com Painel Web
├── readme.md              # Documentação geral da arquitetura do projeto
└── ...
```

---

## 🚀 Arquitetura de Atualização OTA Centralizada pelo Servidor

Toda a gestão de firmware agora é controlada diretamente pelo **Servidor Central (`server/`)** via interface Web:

1. **Painel Web:** O operador acessa o dashboard em `http://<IP_DO_SERVIDOR>:5000` com visualização dos drones conectados e o botão de disparo de atualização.
2. **Disparo via MQTT:** Ao clicar em **"INICIAR ATUALIZAÇÃO DE FIRMWARE (OTA)"**, o servidor publica uma ordem no tópico `drone/cmd/ota` com a URL do binário (`http://<IP_DO_SERVIDOR>:5000/firmware.bin`).
3. **Pull & Gravação no ESP32:** Cada ESP32 conectado recebe a instrução, baixa o binário em blocos via biblioteca nativa `HTTPUpdate`, reporta progresso em tempo real no tópico `drone/ota/status` e reinicia automaticamente na nova versão.

---

## 🚀 Status do Projeto

- [x] Validação de bancada do sensor ToF 90° via I2C com publicação MQTT.
- [x] Desenvolvimento do Aplicativo Mobile para consumo dos tópicos do EMQX e diagnóstico com IA.
- [x] Arquitetura de Atualização de Firmware Over-The-Air (OTA) centralizada no Servidor com Painel Web.
- [x] Disparo de OTA para múltiplos dispositivos em simultâneo via MQTT e HTTPUpdate.
- [ ] Integração do driver do ToF 90° no firmware oficial do ESP-Drone (ESP32-S2).
- [ ] Ajuste da malha de controle de altitude (PID/fusão com barômetro/IMU se aplicável).
