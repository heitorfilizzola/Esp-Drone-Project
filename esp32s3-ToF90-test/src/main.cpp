#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
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
const char* WIFI_SSID     = "JFILIZZOLA";
const char* WIFI_PASSWORD = "07079933";

const char* MQTT_BROKER   = "192.168.1.4";
const int   MQTT_PORT     = 1883;

const char* MQTT_USER     = "esp32s3_tof90";
const char* MQTT_PASS     = "Heitor2006#";

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
m5::unit::UnitUnified Units;
m5::unit::UnitToF90 sensor;

uint32_t lastPublishTime = 0;
const uint32_t PUBLISH_INTERVAL_MS = 200;

void connectWiFi() {
    Serial.printf("\n[WiFi] Conectando a %s", WIFI_SSID);
    setRgbColor(COLOR_BLUE);
    WiFi.mode(WIFI_STA);
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
    }

    Units.update();

    if (sensor.updated()) {
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
    }

    delay(10);
}