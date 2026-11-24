# Servidor Central de Gerenciamento OTA & Motor de IA de Frota (ESP-Drone)

Servidor Node.js (Express) com Painel Web para orquestração de atualizações de firmware Over-The-Air (OTA) em lote e **motor de Inteligência Artificial / Machine Learning em tempo real** para diagnóstico e detecção de anomalias em frotas de drones ESP32 via broker MQTT (EMQX Enterprise) e SSE (Server-Sent Events).

---

## 🚀 Como Executar

### 1. Instalação de Dependências
```bash
cd server
npm install
```

### 2. Configuração de Ambiente (.env)
Copie o exemplo e configure o endereço IP do seu Broker MQTT (local ou na nuvem AWS EC2):
```bash
cp .env.example .env
```

Exemplo de configuração (Nuvem / EC2 ou Local):
```env
PORT=5000
MQTT_BROKER_URL=mqtt://18.222.81.88:1883
MQTT_USERNAME=esp32s3_tof90
MQTT_PASSWORD=SuaSenhaSegura#
SERVER_IP=18.222.81.88
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
- **Métricas de IA:** `http://<IP_DO_SERVIDOR>:5000/api/ai/metrics`

---

## 🧠 Motor de Machine Learning Real (`aiEngine.js`)

O servidor implementa processamento de Inteligência Artificial estatística e não-supervisionada em tempo real sobre a telemetria do sensor ToF-90° (tempo de voo):

1. **Isolation Forest (Liu, Ting, Zhou - IEEE ICDM):**
   - Ensemble de **25 iTrees** (Isolation Trees) retreinadas dinamicamente com subsample de dados a cada 15s.
   - Avaliação contínua da profundidade média de isolamento $s(x, n) = 2^{-E(h(x))/c(n)}$.
   - Extração de features 5D: altitude, velocidade vertical estimada, aceleração vertical, dispersão óptica de fótons e jitter de rede.
   - Alerta preditivo imediato para anomalias aerodinâmicas, reflexão especular ou saturação infravermelha.

2. **K-Means Clustering (Classificador de Regime de Voo):**
   - Agrupamento em tempo real nos regimes operacionais:
     - `Hovering Estável` (velocidade e variação próximas de zero)
     - `Subida / Descida Nominal` (gradiente contínuo e ordenado)
     - `Turbulência / Vórtice de Solo` (alta oscilação vertical)
     - `Dispersão Óptica / Ruído Extremo` (reflexão espelhada ou tapetes de alta absorção IR)

3. **Arquitetura Multi-Dispositivo (`FleetAIMaster`):**
   - **`FleetDeviceAI`**: Instância isolada para cada drone conectado, mantendo buffer deslizante de 80 amostras e histórico individual de anomalias.
   - **`getFleetSummary()`**: Agregação instantânea de toda a frota (saúde média ponderada, total de anomalias e regime global).
   - **`generateAuditReport(targetId)`**: Emissão de relatórios técnicos de auditoria preditiva e recomendações operacionais/PID tanto para drones específicos quanto para a frota completa (`fleet_all`).

---

## 🖥️ Recursos do Painel Web

1. **Painel de IA & Frota Inteligente:**
   - **Dropdown Seletor de Dispositivo:** Alterna dinamicamente entre **"🌐 Visão da Frota Inteira"** e qualquer drone individual conectado.
   - **Banner de Resumo da Frota:** Exibe total de drones ativos, saúde média percentual, contagem de anomalias e total de amostras processadas.
   - **Indicadores Dinâmicos:** Score de saúde (0-100%), score numérico de anomalia, regime de voo inferido, dinâmica vertical estimada e jitter de rede.
   - **Auditoria Preditiva Contextual:** Botão interativo que gera auditorias com parecer técnico e recomendações específicas para o alvo selecionado.
   - **Histórico de Anomalias:** Lista anomalias isoladas em tempo real com timestamp, motivo e identificação do drone emissor.

2. **Painel de Atualização Centralizada OTA:**
   - Botão **"🚀 INICIAR ATUALIZAÇÃO DE FIRMWARE (OTA)"** em destaque no topo da página.
   - Dispara simultaneamente a ordem via MQTT (`drone/cmd/ota`) para todos os drones ou individualmente.
   - Acompanhamento em tempo real via Server-Sent Events (SSE) do percentual de gravação e reinicialização.

3. **Gestão do Firmware Binário:**
   - Utiliza automaticamente o `.bin` gerado pela compilação do PlatformIO (`esp32s3-ToF90-test/.pio/build/.../firmware.bin`).
   - Suporte a upload manual de arquivos `.bin` alternativos diretamente pelo navegador.

---

## ☁️ Implantação em Nuvem (AWS EC2)

O servidor pode ser mantido em produção em instância EC2 (Amazon Linux 2023) sob gerenciador de serviços `systemd`:

```ini
# /etc/systemd/system/esp-drone-server.service
[Unit]
Description=ESP-Drone OTA and Telemetry Web Server
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/Projeto/Esp-Drone-Project/server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Comandos úteis de gerenciamento:
```bash
sudo systemctl restart esp-drone-server.service
sudo systemctl status esp-drone-server.service
journalctl -u esp-drone-server.service -f
```
