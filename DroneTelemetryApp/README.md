# DroneTelemetryApp - Dashboard Móvel de Telemetria de Voo

Aplicativo mobile desenvolvido em **React Native** com **Expo (SDK 58)** para recepção, visualização e acompanhamento em tempo real da telemetria de altitude e status de voo do drone, conectado via **MQTT sobre WebSockets** ao broker **EMQX**.

---

## 📱 Recursos e Funcionalidades

O aplicativo conta com navegação dividida em três módulos principais:

### 1. Aba Telemetria (Tempo Real & Métricas)
- **Conexão em Tempo Real:** Comunicação bidirecional contínua via WebSocket (`ws://<IP>:8083/mqtt`) com reconexão automática e credenciais autenticadas.
- **Monitoramento de Altitude (ToF 90°):** Exibição em tempo real da leitura em milímetros (mm) e centímetros (cm) proveniente do sensor Time-of-Flight (VL53L0X).
- **Altitude Máxima e Mínima:** Rastreamento contínuo dos extremos de altitude atingidos durante o voo, com botão interativo para redefinir as estatísticas.
- **Indicador de Alcance e Status:** Detecção automática de leituras válidas (*ONLINE*) ou fora do campo de medição (*ALCANCE*).
- **Gráfico Histórico Dinâmico:** Visualização vetorial (SVG) com os últimos pontos de medição em tempo real.
- **Alertas em Tempo Real:** Banners automáticos disparados pelo motor de IA ao detectar descidas abruptas, subidas aceleradas ou leituras instáveis.

### 2. Aba OTA Firmware (Gravação via Wi-Fi)
- **Atualização Over-The-Air:** Envio de arquivos compilados de firmware (`.bin`) diretamente para o endpoint HTTP do ESP32 (`/update`) sem fios.
- **Monitoramento de Upload:** Barra de progresso visual com percentual de transferência, contagem de bytes e mensagens de status do ESP32.

### 3. Aba IA Copilot (Diagnóstico de Voo)
- **Score de Estabilidade (0–100%):** Avaliação estatística da dispersão e do desvio padrão das medições de altitude.
- **Classificação Operacional:** Identificação automática do estado de voo (*POUSADO*, *ESTÁVEL*, *TURBULENTO*, *SUBINDO*, *DESCENDO*).
- **Recomendações Técnicas:** Sugestões inteligentes para calibração de ganhos derivativos ($K_d$) da malha PID e diagnóstico da superfície refletora do solo.

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
                                              | (Porta TCP: 1883)     |
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
   EXPO_PUBLIC_MQTT_BROKER_URL=ws://192.168.1.6:8083/mqtt
   EXPO_PUBLIC_MQTT_TOPIC="drone/#"
   EXPO_PUBLIC_MQTT_USERNAME=esp32s3_tof90
   EXPO_PUBLIC_MQTT_PASSWORD="SUA_SENHA_MQTT"
   EXPO_PUBLIC_ESP_IP=192.168.1.6
   ```

> [!IMPORTANT]
> **Atenção ao caractere `#` no `.env`:** No parser de ambiente do Expo/dotenv, qualquer valor contendo o símbolo `#` (como senhas com caracteres especiais ou o wildcard MQTT `drone/#`) **deve ser envolvido entre aspas duplas** (`"..."`). Caso contrário, o parser interpreta o `#` como o início de um comentário e descarta o restante da string, causando falhas de autenticação (`bad_username_or_password`) ou subscrições truncadas para `drone/`.

> [!TIP]
> O IP `192.168.1.6` corresponde ao endereço da máquina local que executa o broker EMQX. Se o IP for alterado no DHCP da rede, basta atualizar a variável `EXPO_PUBLIC_MQTT_BROKER_URL`. Sempre que modificar o arquivo `.env`, reinicie o Expo com cache limpo: `npx expo start -c`.

---

## 🚀 Como Executar o Aplicativo

### Pré-requisitos
* **Node.js** (>= 18.x) e **npm**
* Smartphone com o app **Expo Go** instalado ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent) / [iOS](https://apps.apple.com/app/expo-go/id982107779)) ou emulador configurado.
* Broker **EMQX** em execução com o listener WebSocket ativo na porta `8083`.
* Celular e computador conectados à **mesma rede local Wi-Fi**.

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

---

## 📂 Estrutura de Serviços

* [`src/services/mqttService.ts`](src/services/mqttService.ts): Inicialização do cliente MQTT via WebSocket, reconexão resiliente, tratamento de eventos e sanitização automática de tópicos (`drone/#`).
* [`src/services/aiTelemetryService.ts`](src/services/aiTelemetryService.ts): Motor Edge AI para detecção em tempo real de variações súbitas de altitude, desvio padrão e geração do relatório de diagnóstico de voo com recomendações de estabilidade e calibração PID.
* [`src/services/otaService.ts`](src/services/otaService.ts): Gerenciador de upload de firmware compilado (`.bin`) via requisição HTTP multipart com monitoramento de progresso em tempo real.

---

## 🛠️ Stack Tecnológica

* **Framework:** [Expo](https://expo.dev/) (SDK 58) / [React Native](https://reactnative.dev/)
* **Linguagem:** TypeScript
* **Comunicação MQTT:** [`mqtt`](https://www.npmjs.com/package/mqtt) (WebSocket client)
* **Gráficos e Vetores:** [`react-native-chart-kit`](https://www.npmjs.com/package/react-native-chart-kit) & [`react-native-svg`](https://www.npmjs.com/package/react-native-svg)
