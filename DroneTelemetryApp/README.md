# DroneTelemetryApp - Dashboard Móvel de Telemetria de Voo

Aplicativo mobile desenvolvido em **React Native** com **Expo (SDK 58)** para recepção, visualização e acompanhamento em tempo real da telemetria de altitude e status de voo do drone, conectado via **MQTT sobre WebSockets** ao broker **EMQX Enterprise** (local ou na nuvem AWS EC2).

---

## 📱 Recursos e Funcionalidades

O aplicativo conta com navegação dividida em três módulos principais:

### 1. Aba Telemetria (Tempo Real & Métricas)
- **Conexão em Tempo Real:** Comunicação bidirecional contínua via WebSocket (`ws://<IP_BROKER>:8083/mqtt`) com reconexão automática e credenciais autenticadas.
- **Monitoramento de Altitude (ToF 90°):** Exibição em tempo real da leitura em milímetros (mm) e centímetros (cm) proveniente do sensor Time-of-Flight (VL53L0X).
- **Altitude Máxima e Mínima:** Rastreamento contínuo dos extremos de altitude atingidos durante o voo, com botão interativo para redefinir as estatísticas.
- **Indicador de Alcance e Status:** Detecção automática de leituras válidas (*ONLINE*) ou fora do campo de medição (*ALCANCE*).
- **Métricas de Voo:** Cálculo dinâmico e retenção de altitude mínima e máxima atingidas, com opção de reset.
- **IA Copilot & Telemetria Inteligente:**
  - Análise em tempo real de estabilidade e detecção de anomalias aerodinâmicas/superfície.
  - Relatório diagnóstico de estabilidade de voo com pontuação (Score %) e recomendações automáticas.
- **Gráfico Histórico Dinâmico:** Visualização gráfica vetorial (SVG) da variação de altitude ao longo do tempo.
- **Identificação do Dispositivo:** Exibição do `device_id` e identificação do módulo sensor ativo.
- **Card de Conectividade:** Indicador luminoso em tempo real do estado de sincronização com o broker MQTT.

> [!NOTE]
> As atualizações de Firmware Over-The-Air (OTA) e o diagnóstico avançado de Machine Learning multi-dispositivo (Isolation Forest e K-Means) foram centralizados no **[Servidor Central (`server/`)](file:///home/heitor/Documents/Esp-Drone-Project/server/README.md)** com Painel Web.

---

## 🏗️ Arquitetura de Dados

```
+---------------------+          I2C          +-----------------------+
| Sensor Mini ToF 90° | --------------------> |       ESP32-S3        |
|  (M5Stack U196)     |   SDA: IO04 / SCL:05  |  (Nó de Sensoriamento)|
+---------------------+                       +-----------+-----------+
                                                          |
                                            MQTT (1883)   | Wi-Fi (2.4 GHz)
                                            JSON Payload  | Tópico: drone/sensor/tof90
                                                          v
                                              +-----------------------+
                                              |      Broker EMQX      |
                                              | (AWS EC2: 18.222.81.88|
                                              |  Porta TCP: 1883)     |
                                              | (Porta WS: 8083)      |
                                              +-----------+-----------+
                                                          |
                                       WebSocket (8083)   | Subscrição: drone/#
                                       MQTT sobre WS      v
                                              +-----------------------+
                                              |   DroneTelemetryApp   |
                                              | (React Native / Expo) |
                                              +-----------------------+
```

---

## 📡 Especificação do Payload (JSON)

O aplicativo consome mensagens publicadas no tópico `drone/sensor/tof90` (ou subscritas via `drone/#`):

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

### Campos Mapeados:
| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `device_id` | `string` | Identificador único do dispositivo transmissor |
| `sensor` | `string` | Modelo do sensor óptico em uso (`U196_ToF90`) |
| `distance_mm` | `number` | Distância bruta em milímetros |
| `distance_cm` | `number` | Distância convertida em centímetros |
| `valid` | `boolean` | `true` se dentro do alcance nominal; `false` se fora |
| `timestamp` | `number` | Tempo de operação do microcontrolador (millis) |

---

## ⚙️ Configuração de Rede e Credenciais

As configurações de conexão e credenciais utilizam variáveis de ambiente gerenciadas pelo Expo (`EXPO_PUBLIC_*`).

1. Copie o arquivo `.env.example` para `.env` (este arquivo é ignorado pelo Git):
   ```bash
   cp .env.example .env
   ```

2. Configure suas credenciais reais no arquivo `.env`:
   ```bash
   # Exemplo conectando ao Broker na Nuvem AWS EC2:
   EXPO_PUBLIC_MQTT_BROKER_URL=ws://18.222.81.88:8083/mqtt
   EXPO_PUBLIC_MQTT_TOPIC="drone/#"
   EXPO_PUBLIC_MQTT_USERNAME=esp32s3_tof90
   EXPO_PUBLIC_MQTT_PASSWORD="SuaSenhaMQTT"
   EXPO_PUBLIC_ESP_IP=18.222.81.88
   ```

> [!IMPORTANT]
> **Atenção ao caractere `#` no `.env`:** No parser de ambiente do Expo/dotenv, qualquer valor contendo o símbolo `#` (como senhas com caracteres especiais ou o wildcard MQTT `drone/#`) **deve ser envolvido entre aspas duplas** (`"..."`). Caso contrário, o parser interpreta o `#` como o início de um comentário e descarta o restante da string, causando falhas de autenticação (`bad_username_or_password`) ou subscrições truncadas para `drone/`.

> [!TIP]
> Para desenvolvimento local com broker na mesma máquina, use o IP da interface local (ex: `192.168.1.6`). Sempre que modificar o arquivo `.env`, reinicie o Expo com cache limpo: `npx expo start -c`.

---

## 🚀 Como Executar o Aplicativo

### Pré-requisitos
* **Node.js** (>= 18.x) e **npm**
* Smartphone com o app **Expo Go** instalado ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent) / [iOS](https://apps.apple.com/app/expo-go/id982107779)) ou emulador configurado.
* Broker **EMQX** em execução com o listener WebSocket ativo na porta `8083`.
* Celular e computador conectados à **mesma rede local Wi-Fi** (ou com acesso à internet caso use o broker EC2).

### Instalação e Execução

1. **Instalar as dependências:**
   ```bash
   cd DroneTelemetryApp
   npm install
   ```

2. **Iniciar o servidor de desenvolvimento Expo:**
   ```bash
   npx expo start
   ```

3. **Abrir no dispositivo:**
   * **No smartphone:** Abra o Expo Go e escaneie o QR Code exibido no terminal.
   * **No navegador web:** Pressione `w` no terminal.
   * **No emulador Android:** Pressione `a`.

---

## 🔍 Comandos de Validação e Diagnóstico

Antes de empacotar ou publicar alterações, execute os testes de integridade:

```bash
# Diagnóstico completo de dependências e configuração do Expo
npx expo-doctor

# Checagem estática de tipos TypeScript
npx tsc --noEmit

# Teste de empacotamento (bundler para iOS e Android)
npx expo export
```
