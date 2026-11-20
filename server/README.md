# Servidor Central de Gerenciamento OTA (ESP-Drone)

Servidor Node.js com Painel Web para orquestração e disparo de atualizações de firmware Over-The-Air (OTA) em lote para toda a frota de drones ESP32 via broker MQTT (EMQX) e HTTP.

---

## 🚀 Como Executar

### 1. Instalação de Dependências
```bash
cd server
npm install
```

### 2. Configuração de Ambiente (.env)
Copie o exemplo e configure o endereço IP do seu Broker MQTT:
```bash
cp .env.example .env
```

Exemplo de configuração:
```env
PORT=5000
MQTT_BROKER_URL=mqtt://172.20.10.2:1883
MQTT_USERNAME=esp32s3_tof90
MQTT_PASSWORD=Heitor2006#
SERVER_IP=172.20.10.2
```

### 3. Iniciar o Servidor
```bash
npm start
# ou em modo de desenvolvimento com hot-reload:
npm run dev
```

O servidor abrirá em:
- **Painel Web:** `http://<IP_DO_SERVIDOR>:5000`
- **Download do Firmware:** `http://<IP_DO_SERVIDOR>:5000/firmware.bin`

---

## 🖥️ Recursos do Painel Web

1. **Painel Hero com Botão de Update Centralizado:**
   - Botão **"🚀 INICIAR ATUALIZAÇÃO DE FIRMWARE (OTA)"** em destaque no topo da página.
   - Dispara simultaneamente a ordem para todos os drones conectados ou para um drone específico.
2. **Descoberta em Tempo Real de Dispositivos:**
   - Detecta automaticamente drones que publicam no broker MQTT.
   - Exibe IP, versão de firmware, distância lida pelo sensor ToF-90 e barra de progresso individual.
3. **Gestão do Firmware Binário:**
   - Utiliza automaticamente o arquivo `.bin` compilado pelo PlatformIO (`esp32s3-ToF90-test/.pio/build/esp32-s3-devkitc-1/firmware.bin`).
   - Permite upload manual de qualquer arquivo `.bin` alternativo diretamente pelo navegador.
4. **Console de Logs OTA em Tempo Real:**
   - Mostra logs recebidos via Server-Sent Events (SSE) e mensagens MQTT dos drones em tempo real.
