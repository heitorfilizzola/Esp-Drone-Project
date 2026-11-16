#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <Update.h>
#include <M5UnitUnified.hpp>
#include <M5UnitUnifiedTOF.hpp>
#include <Adafruit_NeoPixel.h>

// ==========================================================
// CONFIGURAÇÃO DO LED RGB NATIVO (WS2812 no GPIO 48)
// ==========================================================
#define RGB_LED_PIN   48
#define NUM_LEDS      1

Adafruit_NeoPixel rgbLed(NUM_LEDS, RGB_LED_PIN, NEO_GRB + NEO_KHZ800);

enum LedColor {
    COLOR_OFF,
    COLOR_RED,    // Erro (Wi-Fi, MQTT ou I2C)
    COLOR_GREEN,  // Operação normal e publicando
    COLOR_BLUE    // Tentando conectar
};

void setRgbColor(LedColor color) {
    switch (color) {
        case COLOR_RED:
            rgbLed.setPixelColor(0, rgbLed.Color(255, 0, 0));   // Vermelho
            break;
        case COLOR_GREEN:
            rgbLed.setPixelColor(0, rgbLed.Color(0, 255, 0));   // Verde
            break;
        case COLOR_BLUE:
            rgbLed.setPixelColor(0, rgbLed.Color(0, 0, 255));   // Azul
            break;
        default:
            rgbLed.setPixelColor(0, rgbLed.Color(0, 0, 0));     // Desligado
            break;
    }
    rgbLed.show();
}

// ==========================================================
// CONFIGURAÇÕES DE REDE E MQTT (EMQX)
// ==========================================================
// As credenciais são carregadas do arquivo local 'secrets.h' (ignorado pelo Git).
// Veja 'include/secrets.example.h' para configurar.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#define SECRET_WIFI_SSID     "SUA_REDE_WIFI"
#define SECRET_WIFI_PASSWORD "SUA_SENHA_WIFI"
#define SECRET_MQTT_BROKER   "192.168.1.4"
#define SECRET_MQTT_PORT     1883
#define SECRET_MQTT_USER     "esp32s3_tof90"
#define SECRET_MQTT_PASS     "SUA_SENHA_MQTT"
#endif

const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

const char* MQTT_BROKER   = SECRET_MQTT_BROKER;
const int   MQTT_PORT     = SECRET_MQTT_PORT;

const char* MQTT_USER     = SECRET_MQTT_USER;
const char* MQTT_PASS     = SECRET_MQTT_PASS;

const char* MQTT_TOPIC    = "drone/sensor/tof90";
const char* CLIENT_ID     = "esp32s3_tof90";

// ==========================================================
// PINAGEM DO SENSOR TOF-90 (M5Stack U196)
// ==========================================================
constexpr uint8_t PIN_SDA = 4;
constexpr uint8_t PIN_SCL = 5;

// Instâncias
WiFiClient espClient;
PubSubClient mqttClient(espClient);
WebServer server(80);
bool isOtaUpdating = false;
static bool isFirstOtaChunk = true;
m5::unit::UnitUnified Units;
m5::unit::UnitToF90 sensor;

uint32_t lastPublishTime = 0;
const uint32_t PUBLISH_INTERVAL_MS = 200;

// ==========================================================
// CONFIGURAÇÃO DO SERVIDOR WEB E OTA HTTP (PORTA 80)
// ==========================================================
void setupOtaServer() {
    // Endpoint para teste de conectividade e status
    server.on("/", HTTP_GET, []() {
        server.sendHeader("Access-Control-Allow-Origin", "*");
        server.send(200, "application/json", "{\"status\":\"online\",\"device_id\":\"" + String(CLIENT_ID) + "\",\"service\":\"ESP32 Drone OTA\"}");
    });

    server.on("/status", HTTP_GET, []() {
        server.sendHeader("Access-Control-Allow-Origin", "*");
        JsonDocument doc;
        doc["status"] = "online";
        doc["device_id"] = CLIENT_ID;
        doc["ip"] = WiFi.localIP().toString();
        doc["free_heap"] = ESP.getFreeHeap();
        doc["uptime_ms"] = millis();
        doc["ota_ready"] = true;
        String response;
        serializeJson(doc, response);
        server.send(200, "application/json", response);
    });

    // Suporte a CORS Preflight para requisições do App Mobile (Web / Emuladores)
    server.on("/update", HTTP_OPTIONS, []() {
        server.sendHeader("Access-Control-Allow-Origin", "*");
        server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
        server.send(204);
    });

    server.on("/status", HTTP_OPTIONS, []() {
        server.sendHeader("Access-Control-Allow-Origin", "*");
        server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
        server.send(204);
    });

    // Rota POST /update com handler de upload multipart
    server.on("/update", HTTP_POST, []() {
        server.sendHeader("Connection", "close");
        server.sendHeader("Access-Control-Allow-Origin", "*");
        if (Update.hasError()) {
            String errDetail = "FALHA NO OTA: " + String(Update.errorString()) + " (codigo " + String(Update.getError()) + ")";
            server.send(500, "text/plain", errDetail);
            setRgbColor(COLOR_RED);
            isOtaUpdating = false;
        } else {
            server.send(200, "text/plain", "Firmware gravado com sucesso! Reiniciando ESP32...");
            setRgbColor(COLOR_GREEN);
            delay(1000);
            ESP.restart();
        }
    }, []() {
        HTTPUpload& upload = server.upload();
        if (upload.status == UPLOAD_FILE_START) {
            isOtaUpdating = true;
            isFirstOtaChunk = true;
            Serial.printf("\n[OTA] Recebendo arquivo: %s\n", upload.filename.c_str());
            setRgbColor(COLOR_BLUE);

            if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
                Serial.printf("[OTA][ERRO] Update.begin falhou: %s (cod %d)\n", Update.errorString(), Update.getError());
                Update.printError(Serial);
                setRgbColor(COLOR_RED);
            }
        } else if (upload.status == UPLOAD_FILE_WRITE) {
            uint8_t* writeBuf = upload.buf;
            size_t writeSize = upload.currentSize;

            // O parser multipart do WebServer do ESP32 pode deixar sobras de cabeçalhos (\r\n ou Content-Length)
            // enviados por clientes como Android/OkHttp. Procuramos o magic byte 0xE9 nos primeiros bytes do primeiro bloco.
            if (isFirstOtaChunk) {
                isFirstOtaChunk = false;
                size_t offset = 0;
                while (offset < writeSize && writeBuf[offset] != 0xE9) {
                    offset++;
                }
                if (offset > 0 && offset < writeSize) {
                    Serial.printf("[OTA] Ajustando cabecalho HTTP: pulando %u bytes de preambulo antes do magic byte 0xE9\n", (unsigned int)offset);
                    writeBuf += offset;
                    writeSize -= offset;
                } else if (offset >= writeSize) {
                    Serial.println("[OTA][ERRO] Magic byte 0xE9 nao encontrado no primeiro bloco recebido!");
                }
            }

            if (Update.write(writeBuf, writeSize) != writeSize) {
                Serial.printf("[OTA][ERRO] Update.write falhou: %s (cod %d)\n", Update.errorString(), Update.getError());
                Update.printError(Serial);
                setRgbColor(COLOR_RED);
            }
        } else if (upload.status == UPLOAD_FILE_END) {
            if (Update.end(true)) {
                Serial.printf("[OTA] Gravacao concluida com sucesso (%u bytes)!\n", upload.totalSize);
            } else {
                Serial.printf("[OTA][ERRO] Update.end falhou: %s (cod %d, total %u bytes)\n", Update.errorString(), Update.getError(), upload.totalSize);
                Update.printError(Serial);
                setRgbColor(COLOR_RED);
            }
            isOtaUpdating = false;
        } else if (upload.status == UPLOAD_FILE_ABORTED) {
            Update.end();
            Serial.println("[OTA] Gravacao abortada pelo cliente!");
            isOtaUpdating = false;
            setRgbColor(COLOR_RED);
        }
    });

    server.begin();
    Serial.println("[HTTP] Servidor Web e OTA escutando na porta 80.");
}

void connectWiFi() {
    Serial.printf("\n[WiFi] Conectando a %s", WIFI_SSID);
    setRgbColor(COLOR_BLUE);
    WiFi.mode(WIFI_STA);
    WiFi.setTxPower(WIFI_POWER_17dBm);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] Conectado! IP do ESP32: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[WiFi][ERRO] Falha ao conectar no Wi-Fi.");
        setRgbColor(COLOR_RED);
    }
}

void connectMQTT() {
    if (WiFi.status() != WL_CONNECTED) {
        setRgbColor(COLOR_RED);
        return;
    }

    if (!mqttClient.connected()) {
        Serial.printf("[MQTT] Conectando ao Broker EMQX (%s:%d)... ", MQTT_BROKER, MQTT_PORT);
        
        bool connected = false;
        if (strlen(MQTT_USER) > 0) {
            connected = mqttClient.connect(CLIENT_ID, MQTT_USER, MQTT_PASS);
        } else {
            connected = mqttClient.connect(CLIENT_ID);
        }

        if (connected) {
            Serial.println("CONECTADO COM SUCESSO!");
            setRgbColor(COLOR_GREEN);
        } else {
            Serial.printf("FALHA (codigo=%d). Tentara novamente em breve.\n", mqttClient.state());
            setRgbColor(COLOR_RED); // Acende em VERMELHO por erro de senha/autenticação
        }
    }
}

void scanI2C() {
    Serial.println("\n[I2C] Escaneando barramento...");
    byte count = 0;
    for (byte addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        byte err = Wire.endTransmission();
        if (err == 0) {
            Serial.printf("[I2C] Dispositivo detectado no endereco: 0x%02X", addr);
            if (addr == 0x29) {
                Serial.print("  <-- SENSOR TOF-90 (VL53L0X) DETECTADO!");
            }
            Serial.println();
            count++;
        }
    }
    if (count == 0) {
        Serial.println("[I2C][ALERTA] Nenhum dispositivo I2C encontrado!");
        setRgbColor(COLOR_RED);
    }
}

void setup() {
    Serial.begin(115200);

    // Inicializa o LED RGB embutido no GPIO 48
    rgbLed.begin();
    rgbLed.setBrightness(30); // Brilho em 30% para não ofuscar
    setRgbColor(COLOR_BLUE);

    for (int i = 0; i < 30 && !Serial; i++) {
        delay(100);
    }
    delay(300);

    Serial.println("\n==========================================");
    Serial.println(" ESP32-S3 + ToF-90 -> Broker EMQX (MQTT)  ");
    Serial.println("==========================================");

    connectWiFi();
    setupOtaServer();
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);

    pinMode(PIN_SDA, INPUT_PULLUP);
    pinMode(PIN_SCL, INPUT_PULLUP);
    Wire.begin(PIN_SDA, PIN_SCL);
    Wire.setTimeOut(100);
    Wire.setClock(100000);

    scanI2C();

    Units.add(sensor, Wire);
    while (!Units.begin()) {
        Serial.println("[ERRO] Falha ao comunicar com ToF-90. Tentando novamente em 2s...");
        setRgbColor(COLOR_RED);
        delay(2000);
        scanI2C();
    }

    Serial.println("[OK] Sensor ToF-90 pronto! Iniciando leituras...\n");
}

void loop() {
    server.handleClient();

    // Se estiver em processo de atualização OTA, pausa MQTT e sensores para estabilidade da gravação Flash
    if (isOtaUpdating) {
        delay(2);
        return;
    }

    if (WiFi.status() == WL_CONNECTED) {
        if (!mqttClient.connected()) {
            setRgbColor(COLOR_RED);
            static uint32_t lastReconnect = 0;
            if (millis() - lastReconnect > 4000) {
                lastReconnect = millis();
                connectMQTT();
            }
        } else {
            mqttClient.loop();
        }
    } else {
        setRgbColor(COLOR_RED);
        static uint32_t lastWifiRetry = 0;
        if (millis() - lastWifiRetry > 3000) {
            lastWifiRetry = millis();
            Serial.printf("[DIAGNOSTICO] Wi-Fi desconectado! Tentando reconectar a '%s'...\n", WIFI_SSID);
            WiFi.reconnect();
        }
    }

    Units.update();

    static uint32_t lastSensorLog = 0;
    if (sensor.updated()) {
        lastSensorLog = millis();
        int16_t distance_mm = sensor.range();

        if (millis() - lastPublishTime >= PUBLISH_INTERVAL_MS) {
            lastPublishTime = millis();

            JsonDocument doc;
            doc["device_id"]   = CLIENT_ID;
            doc["sensor"]      = "U196_ToF90";
            doc["distance_mm"] = distance_mm;
            doc["distance_cm"] = (distance_mm >= 0) ? (distance_mm / 10.0f) : -1.0f;
            doc["valid"]       = (distance_mm >= 0);
            doc["timestamp"]   = millis();

            char jsonBuffer[256];
            serializeJson(doc, jsonBuffer);

            if (distance_mm >= 0) {
                Serial.printf("Distancia: %4d mm (%.1f cm) -> ", distance_mm, distance_mm / 10.0f);
            } else {
                Serial.print("Distancia: Fora de alcance    -> ");
            }

            if (mqttClient.connected()) {
                mqttClient.publish(MQTT_TOPIC, jsonBuffer);
                Serial.printf("Publicado no EMQX [%s]: %s\n", MQTT_TOPIC, jsonBuffer);
                setRgbColor(COLOR_GREEN); // Verde fixo quando tudo funciona
            } else {
                Serial.println("MQTT desconectado (aguardando reconexao)");
                setRgbColor(COLOR_RED);   // Vermelho quando dá erro de conexão
            }
        }
    } else {
        // Se o sensor parar de responder por mais de 3s, avisa no Serial em vez de ficar mudo
        if (millis() - lastSensorLog > 3000) {
            lastSensorLog = millis();
            Serial.printf("[SENSOR][ALERTA] Aguardando leitura do ToF-90 no I2C (SDA=%d, SCL=%d)... (WiFi=%s, MQTT=%s)\n",
                          PIN_SDA, PIN_SCL,
                          (WiFi.status() == WL_CONNECTED ? "OK" : "OFF"),
                          (mqttClient.connected() ? "OK" : "OFF"));
        }
    }

    Serial.flush();
    delay(10);
}