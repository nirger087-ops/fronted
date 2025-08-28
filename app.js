class SecureMessenger {
    constructor() {
        this.sodium = null;
        this.socket = null;
        this.myUserId = null;
        this.myUsername = null;
        this.identityKeyPair = null;
        this.signedPreKeyPair = null;
        this.signedPreKeySignature = null;
        this.sessionKeys = {};
        this.serverUrl = 'wss://secure-messenger-backend-xjvb.onrender.com';
        this.currentChat = null;
        this.chats = [];
        this.messages = {};
        
        // Новые свойства для пула ключей
        this.keyPool = {}; // { userId: [key1, key2, ...] }
        this.usedKeys = new Set(); // track used key IDs
        this.keyPoolSize = 1000; // количество ключей в пуле
    }

    async init() {
        try {
            this.sodium = await window.sodium;
            console.log("Libsodium готов к работе");
            this.showSystemMessage("🔐 Криптографическая система инициализирована", "system");
        } catch (error) {
            console.error("Ошибка загрузки libsodium:", error);
            this.showSystemMessage("❌ Ошибка загрузки системы безопасности", "error");
        }
    }

    async checkServerConnection() {
        try {
            const API_BASE = this.serverUrl.replace('wss://', 'https://').replace('/ws', '');
            const response = await fetch(`${API_BASE}/health`, {
                method: 'GET',
                mode: 'cors'
            });
            
            if (response.ok) {
                const health = await response.json();
                this.showSystemMessage(`✅ Сервер доступен. Статус: ${health.status}`, "system");
                return true;
            } else {
                this.showSystemMessage("❌ Сервер недоступен", "error");
                return false;
            }
        } catch (error) {
            this.showSystemMessage("❌ Ошибка подключения к серверу", "error");
            return false;
        }
    }

    async login() {
        const username = document.getElementById('usernameInput').value.trim();
        if (!username) {
            this.showSystemMessage("⚠️ Введите имя пользователя", "error");
            return;
        }

        // Проверяем соединение с сервером
        const serverAvailable = await this.checkServerConnection();
        if (!serverAvailable) {
            this.showSystemMessage("⚠️ Сервер недоступен. Проверьте подключение.", "error");
            return;
        }

        this.myUsername = username;
        this.myUserId = username + '_' + Math.random().toString(36).substr(2, 8);
        
        document.getElementById('currentUser').textContent = username;
        document.getElementById('myUserId').textContent = this.myUserId;
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('chatSection').style.display = 'flex';

        this.showSystemMessage("🎉 Добро пожаловать в Secure Messenger!", "system");
        this.showSystemMessage("🔑 Генерирую ключи безопасности...", "system");

        // Генерируем пул ключей вместо X3DH
        await this.generateKeyPool();
        this.connectWebSocket();
        
        setTimeout(() => this.loadChats(), 1000);
        
        this.showSystemMessage("✅ Готов к безопасному общению!", "system");
        this.showSystemMessage("📋 Скопируйте ваш ID и отправьте собеседнику", "system");
    }

    async generateKeyPool() {
        try {
            this.showSystemMessage("🔑 Генерирую пул ключей...", "system");
            
            const pool = [];
            for (let i = 0; i < this.keyPoolSize; i++) {
                const key = this.sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
                pool.push({
                    id: i,
                    key: key,
                    used: false
                });
            }
            
            this.keyPool[this.myUserId] = pool;
            this.showSystemMessage(`✅ Сгенерировано ${this.keyPoolSize} ключей`, "system");
            
            // Отправляем пул ключей на сервер
            await this.uploadKeyPool();
            
        } catch (error) {
            console.error("Key pool generation error:", error);
            this.showSystemMessage("❌ Ошибка генерации ключей", "error");
        }
    }

    async uploadKeyPool() {
        try {
            const poolData = this.keyPool[this.myUserId].map(item => ({
                id: item.id,
                key: this.sodium.to_base64(item.key)
            }));

            const API_BASE = this.serverUrl.replace('wss://', 'https://').replace('/ws', '');
            const response = await fetch(`${API_BASE}/keypool/upload/${this.myUserId}`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ keys: poolData }),
                mode: 'cors'
            });

            if (response.ok) {
                this.showSystemMessage("✅ Пул ключей загружен на сервер", "system");
            }
        } catch (error) {
            console.error("Key pool upload error:", error);
        }
    }

    async downloadKeyPool(userId) {
        try {
            const API_BASE = this.serverUrl.replace('wss://', 'https://').replace('/ws', '');
            const response = await fetch(`${API_BASE}/keypool/download/${userId}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors'
            });

            if (response.ok) {
                const data = await response.json();
                const pool = data.keys.map(item => ({
                    id: item.id,
                    key: this.sodium.from_base64(item.key),
                    used: false
                }));
                
                this.keyPool[userId] = pool;
                this.showSystemMessage(`✅ Загружен пул ключей пользователя ${userId}`, "system");
                return true;
            }
            return false;
        } catch (error) {
            console.error("Key pool download error:", error);
            return false;
        }
    }

    encryptMessageWithRandomKey(plaintext, userId) {
        try {
            const pool = this.keyPool[userId];
            if (!pool || pool.length === 0) {
                throw new Error("No keys available for encryption");
            }

            // Ищем неиспользованный ключ
            const availableKeys = pool.filter(key => !key.used);
            if (availableKeys.length === 0) {
                throw new Error("All keys have been used");
            }

            // Выбираем случайный ключ
            const randomIndex = Math.floor(Math.random() * availableKeys.length);
            const selectedKey = availableKeys[randomIndex];
            
            // Помечаем ключ как использованный
            selectedKey.used = true;
            this.usedKeys.add(selectedKey.id);

            // Шифруем сообщение
            const nonce = this.sodium.randombytes_buf(this.sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
            const ciphertext = this.sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
                plaintext,
                null,
                null,
                nonce,
                selectedKey.key
            );

            // Комбинируем nonce + ciphertext + key ID
            const combined = new Uint8Array(nonce.length + ciphertext.length + 4);
            combined.set(nonce);
            combined.set(ciphertext, nonce.length);
            
            // Добавляем ID ключа (4 байта)
            const keyIdBytes = new Uint8Array(new Uint32Array([selectedKey.id]).buffer);
            combined.set(keyIdBytes, nonce.length + ciphertext.length);

            return this.sodium.to_base64(combined);
            
        } catch (error) {
            console.error("Encryption error:", error);
            throw error;
        }
    }

    decryptMessageWithKeyId(encodedMessage, userId) {
        try {
            const combined = this.sodium.from_base64(encodedMessage);
            
            // Извлекаем компоненты
            const nonce = combined.slice(0, this.sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
            const ciphertext = combined.slice(
                this.sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES, 
                combined.length - 4
            );
            
            // Извлекаем ID ключа (последние 4 байта)
            const keyIdBytes = combined.slice(combined.length - 4);
            const keyId = new Uint32Array(keyIdBytes.buffer)[0];
            
            // Находим ключ по ID
            const pool = this.keyPool[userId];
            if (!pool) {
                throw new Error("Key pool not found");
            }
            
            const keyData = pool.find(key => key.id === keyId);
            if (!keyData) {
                throw new Error(`Key with ID ${keyId} not found`);
            }

            // Расшифровываем
            const decrypted = this.sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                null,
                ciphertext,
                null,
                nonce,
                keyData.key
            );
            
            return this.sodium.to_string(decrypted);
            
        } catch (error) {
            console.error("Decryption error:", error);
            throw error;
        }
    }

    async sendMessage() {
        const recipientId = document.getElementById('recipientInput').value.trim();
        const messageText = document.getElementById('messageInput').value.trim();

        if (!recipientId) {
            this.showSystemMessage("⚠️ Введите ID получателя", "error");
            return;
        }

        if (!messageText) {
            this.showSystemMessage("⚠️ Введите сообщение", "error");
            return;
        }

        try {
            // Загружаем пул ключей получателя, если еще нет
            if (!this.keyPool[recipientId]) {
                this.showSystemMessage("📥 Загружаю ключи получателя...", "system");
                const success = await this.downloadKeyPool(recipientId);
                if (!success) {
                    throw new Error("Не удалось загрузить ключи получателя");
                }
                
                // Добавляем чат в список
                this.addChatToList(recipientId);
            }

            // Шифруем сообщение
            const encrypted = this.encryptMessageWithRandomKey(messageText, recipientId);
            
            // Отправляем
            this.socket.send(JSON.stringify({
                to: recipientId,
                from: this.myUserId,
                encrypted_message: encrypted
            }));

            // Сохраняем сообщение в историю
            this.saveMessageToHistory(recipientId, {
                sender: this.myUserId,
                text: messageText,
                timestamp: new Date(),
                type: 'sent'
            });

            // Показываем сообщение у себя
            this.showMessage("Вы", messageText, "sent");
            
            // Обновляем список чатов
            this.updateChatList();
            
            // Очищаем поле ввода
            document.getElementById('messageInput').value = '';
            
            // Фокусируемся обратно на поле ввода
            document.getElementById('messageInput').focus();

        } catch (error) {
            console.error("Send error:", error);
            this.showSystemMessage(`❌ Ошибка отправки: ${error.message}`, "error");
        }
    }

    async handleIncomingMessage(messageData) {
        // Пропускаем свои же сообщения (если они приходят обратно)
        if (messageData.from === this.myUserId) return;

        try {
            // Загружаем пул ключей отправителя, если еще нет
            if (!this.keyPool[messageData.from]) {
                this.showSystemMessage("📥 Загружаю ключи отправителя...", "system");
                const success = await this.downloadKeyPool(messageData.from);
                if (!success) {
                    throw new Error("Не удалось загрузить ключи отправителя");
                }
                
                // Добавляем чат в список
                this.addChatToList(messageData.from);
            }

            // Расшифровываем
            const decrypted = this.decryptMessageWithKeyId(
                messageData.encrypted_message, 
                messageData.from
            );
            
            // Сохраняем сообщение в историю
            this.saveMessageToHistory(messageData.from, {
                sender: messageData.from,
                text: decrypted,
                timestamp: new Date(),
                type: 'received'
            });
            
            this.showMessage(messageData.from, decrypted, "received");
            
            // Обновляем список чатов
            this.updateChatList();
            
            // Проигрываем звук уведомления
            this.playNotificationSound();
            
        } catch (error) {
            console.error("Message handling error:", error);
            this.showSystemMessage(`❌ Ошибка расшифровки: ${error.message}`, "error");
        }
    }

    // Остальные методы остаются без изменений
    async performX3DH(otherUserId) {
        // ... существующий код
    }

    async loadChats() {
        // ... существующий код
    }

    renderChatList() {
        // ... существующий код
    }

    addChatToList(userId) {
        // ... существующий код
    }

    updateChatList() {
        // ... существующий код
    }

    async openChat(userId) {
        // ... существующий код
    }

    async loadChatHistory(userId) {
        // ... существующий код
    }

    saveMessageToHistory(userId, message) {
        // ... существующий код
    }

    showSystemMessage(text, type) {
        // ... существующий код
    }

    showMessage(sender, text, type) {
        // ... существующий код
    }

    addMessageToChatbox(sender, text, cssClass) {
        // ... существующий код
    }

    clearChat() {
        // ... существующий код
    }

    formatMessage(text) {
        // ... существующий код
    }

    formatTime(date) {
        // ... существующий код
    }

    playNotificationSound() {
        // ... существующий код
    }

    copyUserId() {
        // ... существующий код
    }

    connectWebSocket() {
        // ... существующий код
    }
}

// Инициализация мессенджера
const messenger = new SecureMessenger();

// Загрузка libsodium и инициализация
window.addEventListener('load', async () => {
    await messenger.init();
});

// Глобальные функции для HTML кнопок
function login() {
    messenger.login();
}

function sendMessage() {
    messenger.sendMessage();
}

// Обработка нажатия Enter
document.getElementById('messageInput')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

document.getElementById('recipientInput')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('messageInput').focus();
    }
});

// Копирование ID по клику
document.addEventListener('click', function(e) {
    if (e.target.id === 'myUserId') {
        messenger.copyUserId();
    }
});

// Адаптивный дизайн - скрываем/показываем sidebar на мобильных
function handleResize() {
    const sidebar = document.querySelector('.chat-sidebar');
    const mainArea = document.querySelector('.main-chat-area');
    
    if (window.innerWidth <= 768) {
        sidebar.style.display = 'none';
        mainArea.style.flex = '1';
    } else {
        sidebar.style.display = 'flex';
        mainArea.style.flex = '1';
    }
}

window.addEventListener('resize', handleResize);
window.addEventListener('load', handleResize);
