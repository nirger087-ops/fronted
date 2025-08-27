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
        this.serverUrl = 'wss://opszcqxlinvqmofpelrm.supabase.co'; // ЗАМЕНИТЕ на ваш URL!
        this.currentChat = null;
        this.chats = [];
        this.messages = {};
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

    async login() {
        const username = document.getElementById('usernameInput').value.trim();
        if (!username) {
            this.showSystemMessage("⚠️ Введите имя пользователя", "error");
            return;
        }

        this.myUsername = username;
        this.myUserId = username + '_' + Math.random().toString(36).substr(2, 8);
        
        document.getElementById('currentUser').textContent = username;
        document.getElementById('myUserId').textContent = this.myUserId;
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('chatSection').style.display = 'flex';

        // Показываем приветственное сообщение
        this.showSystemMessage("🎉 Добро пожаловать в Secure Messenger!", "system");
        this.showSystemMessage("🔑 Генерирую ключи безопасности...", "system");

        await this.generateKeys();
        await this.uploadKeyBundle();
        this.connectWebSocket();
        
        // Загружаем чаты после подключения
        setTimeout(() => this.loadChats(), 1000);
        
        this.showSystemMessage("✅ Готов к безопасному общению!", "system");
        this.showSystemMessage("📋 Скопируйте ваш ID и отправьте собеседнику", "system");
    }

    async generateKeys() {
        try {
            // Генерация ключевых пар
            this.identityKeyPair = this.sodium.crypto_box_keypair();
            this.signedPreKeyPair = this.sodium.crypto_box_keypair();
            
            // Подпись Signed PreKey
            this.signedPreKeySignature = this.sodium.crypto_sign_detached(
                this.signedPreKeyPair.publicKey,
                this.identityKeyPair.privateKey
            );

            console.log("Ключи безопасности сгенерированы");
        } catch (error) {
            console.error("Ошибка генерации ключей:", error);
            this.showSystemMessage("❌ Ошибка создания ключей безопасности", "error");
            throw error;
        }
    }

    async uploadKeyBundle() {
        try {
            const bundle = {
                identityKey: this.sodium.to_base64(this.identityKeyPair.publicKey),
                signedPreKey: this.sodium.to_base64(this.signedPreKeyPair.publicKey),
                signature: this.sodium.to_base64(this.signedPreKeySignature),
                username: this.myUsername,
                timestamp: new Date().toISOString()
            };

            const response = await fetch(`https://your-render-app.onrender.com/keys/upload/${this.myUserId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bundle)
            });

            if (response.ok) {
                console.log("Ключи загружены на сервер");
            }
        } catch (error) {
            console.error("Ошибка загрузки ключей:", error);
        }
    }

    connectWebSocket() {
        this.socket = new WebSocket(`${this.serverUrl}/ws/${this.myUserId}`);

        this.socket.onopen = () => {
            this.showSystemMessage("✅ Подключение к secure-серверу установлено", "system");
        };

        this.socket.onmessage = async (event) => {
            try {
                const messageData = JSON.parse(event.data);
                await this.handleIncomingMessage(messageData);
            } catch (error) {
                console.error("Ошибка обработки сообщения:", error);
                this.showSystemMessage("❌ Ошибка обработки входящего сообщения", "error");
            }
        };

        this.socket.onclose = () => {
            this.showSystemMessage("🔌 Соединение разорвано. Попытка переподключения...", "system");
            setTimeout(() => this.connectWebSocket(), 3000);
        };

        this.socket.onerror = (error) => {
            console.error("WebSocket error:", error);
            this.showSystemMessage("❌ Ошибка соединения", "error");
        };
    }

    async handleIncomingMessage(messageData) {
        // Пропускаем свои же сообщения (если они приходят обратно)
        if (messageData.from === this.myUserId) return;

        // Если это первое сообщение от пользователя - выполняем X3DH
        if (!this.sessionKeys[messageData.from]) {
            try {
                this.showSystemMessage(`🔑 Устанавливаю secure-соединение с ${messageData.from}...`, "system");
                await this.performX3DH(messageData.from);
                this.showSystemMessage(`✅ Secure-соединение с ${messageData.from} установлено!`, "system");
                
                // Добавляем чат в список
                this.addChatToList(messageData.from);
                
            } catch (error) {
                this.showSystemMessage(`❌ Ошибка установки secure-соединения: ${error.message}`, "error");
                return;
            }
        }

        // Расшифровываем сообщение
        try {
            const decrypted = this.decryptMessage(
                messageData.encrypted_message, 
                this.sessionKeys[messageData.from].rootKey
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
            console.error("Decryption error:", error);
            this.showSystemMessage(`❌ Не удалось расшифровать сообщение от ${messageData.from}`, "error");
        }
    }

    async performX3DH(otherUserId) {
        try {
            this.showSystemMessage(`📡 Запрашиваю ключи пользователя ${otherUserId}...`, "system");
            
            // Запрос bundle другого пользователя
            const response = await fetch(`https://your-render-app.onrender.com/keys/bundle/${otherUserId}`);
            if (!response.ok) throw new Error("Пользователь не найден или ключи недоступны");
            
            const bundle = await response.json();
            const ikOther = this.sodium.from_base64(bundle.identityKey);
            const spkOther = this.sodium.from_base64(bundle.signedPreKey);
            const sigOther = this.sodium.from_base64(bundle.signature);

            // Проверка подписи
            this.showSystemMessage("🔍 Проверяю подпись ключей...", "system");
            const isValid = this.sodium.crypto_sign_verify_detached(sigOther, spkOther, ikOther);
            if (!isValid) throw new Error("Неверная подпись ключа - возможна атака!");

            // Генерация ephemeral ключа
            this.showSystemMessage("🔑 Генерирую временные ключи...", "system");
            const ephKeyPair = this.sodium.crypto_box_keypair();

            // Вычисление общих секретов
            this.showSystemMessage("⚡ Вычисляю общий секрет...", "system");
            const dh1 = this.sodium.crypto_scalarmult(this.identityKeyPair.privateKey, spkOther);
            const dh2 = this.sodium.crypto_scalarmult(ephKeyPair.privateKey, ikOther);
            const dh3 = this.sodium.crypto_scalarmult(ephKeyPair.privateKey, spkOther);

            // Создание мастер-ключа
            const sharedSecret = new Uint8Array([...dh1, ...dh2, ...dh3]);
            const rootKey = this.sodium.crypto_generichash(32, sharedSecret);

            this.sessionKeys[otherUserId] = {
                rootKey: rootKey,
                ephemeralPrivate: ephKeyPair.privateKey,
                timestamp: Date.now()
            };

            return rootKey;

        } catch (error) {
            console.error("X3DH error:", error);
            throw error;
        }
    }

    async loadChats() {
        try {
            this.showSystemMessage("📋 Загружаю список чатов...", "system");
            
            // В реальном приложении здесь был бы запрос к API
            // Пока имитируем загрузку чатов
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Для демонстрации - пустой список чатов
            this.chats = [];
            this.renderChatList();
            
        } catch (error) {
            console.error("Error loading chats:", error);
            this.showSystemMessage("❌ Ошибка загрузки чатов", "error");
        }
    }

    renderChatList() {
        const chatList = document.getElementById('chatList');
        if (!chatList) return;

        if (this.chats.length === 0) {
            chatList.innerHTML = `
                <div style="text-align: center; padding: 20px; color: #64748b;">
                    <p>Чатов пока нет</p>
                    <p style="font-size: 12px; margin-top: 8px;">Начните общение, отправив сообщение</p>
                </div>
            `;
            return;
        }

        chatList.innerHTML = this.chats.map(chat => `
            <div class="chat-item" onclick="messenger.openChat('${chat.userId}')" 
                 style="padding: 12px; border-bottom: 1px solid #e5e7eb; cursor: pointer; transition: background 0.2s;"
                 onmouseover="this.style.background='#f1f5f9'" 
                 onmouseout="this.style.background='transparent'">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: #1f2937;">${chat.username}</strong>
                    <span style="font-size: 12px; color: #64748b;">${this.formatTime(chat.lastMessageTime)}</span>
                </div>
                <p style="margin: 4px 0 0 0; font-size: 14px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${chat.lastMessage}
                </p>
            </div>
        `).join('');
    }

    addChatToList(userId) {
        // Проверяем, нет ли уже такого чата
        if (!this.chats.some(chat => chat.userId === userId)) {
            this.chats.push({
                userId: userId,
                username: userId.split('_')[0], // Извлекаем имя из ID
                lastMessage: 'Новое сообщение',
                lastMessageTime: new Date()
            });
            this.renderChatList();
        }
    }

    updateChatList() {
        // Обновляем время последнего сообщения для активного чата
        if (this.currentChat) {
            const chat = this.chats.find(c => c.userId === this.currentChat);
            if (chat) {
                chat.lastMessageTime = new Date();
                this.renderChatList();
            }
        }
    }

    async openChat(userId) {
        this.currentChat = userId;
        document.getElementById('recipientInput').value = userId;
        document.getElementById('chatTitle').textContent = `Чат с ${userId.split('_')[0]}`;
        
        // Очищаем чат
        this.clearChat();
        
        // Загружаем историю сообщений
        await this.loadChatHistory(userId);
        
        this.showSystemMessage(`💬 Открыт чат с ${userId.split('_')[0]}`, "system");
    }

    async loadChatHistory(userId) {
        try {
            // В реальном приложении здесь был бы запрос к API /messages
            // Показываем сообщение о загрузке
            this.showSystemMessage("🕒 Загружаю историю сообщений...", "system");
            
            // Имитация загрузки
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Если есть сообщения в истории - показываем их
            if (this.messages[userId]) {
                this.messages[userId].forEach(msg => {
                    this.showMessage(msg.sender === this.myUserId ? "Вы" : msg.sender, msg.text, msg.type);
                });
            }
            
        } catch (error) {
            console.error("Error loading chat history:", error);
            this.showSystemMessage("❌ Ошибка загрузки истории сообщений", "error");
        }
    }

    saveMessageToHistory(userId, message) {
        if (!this.messages[userId]) {
            this.messages[userId] = [];
        }
        this.messages[userId].push(message);
    }

    encryptMessage(plaintext, key) {
        const nonce = this.sodium.randombytes_buf(this.sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
        const ciphertext = this.sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
            plaintext,
            null,
            null,
            nonce,
            key
        );

        const combined = new Uint8Array(nonce.length + ciphertext.length);
        combined.set(nonce);
        combined.set(ciphertext, nonce.length);

        return this.sodium.to_base64(combined);
    }

    decryptMessage(encodedMessage, key) {
        const combined = this.sodium.from_base64(encodedMessage);
        const nonce = combined.slice(0, this.sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
        const ciphertext = combined.slice(this.sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

        try {
            const decrypted = this.sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
                null,
                ciphertext,
                null,
                nonce,
                key
            );
            return this.sodium.to_string(decrypted);
        } catch (error) {
            throw new Error("Decryption failed");
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
            // Если сессия не установлена - выполняем X3DH
            if (!this.sessionKeys[recipientId]) {
                this.showSystemMessage(`🔑 Устанавливаю secure-соединение с ${recipientId}...`, "system");
                await this.performX3DH(recipientId);
                this.showSystemMessage(`✅ Secure-соединение с ${recipientId} установлено!`, "system");
                
                // Добавляем чат в список
                this.addChatToList(recipientId);
            }

            // Шифруем и отправляем сообщение
            const encrypted = this.encryptMessage(messageText, this.sessionKeys[recipientId].rootKey);
            
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

    showSystemMessage(text, type) {
        this.addMessageToChatbox("Система", text, type);
    }

    showMessage(sender, text, type) {
        this.addMessageToChatbox(sender, text, type);
    }

    addMessageToChatbox(sender, text, cssClass) {
        const chatbox = document.getElementById('chatbox');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${cssClass}`;
        
        // Форматируем сообщение
        const formattedText = this.formatMessage(text);
        const displayName = sender === this.myUserId ? "Вы" : sender;
        
        messageElement.innerHTML = `<strong>${displayName}:</strong> ${formattedText}`;
        
        // Анимация появления
        messageElement.style.opacity = '0';
        messageElement.style.transform = 'translateY(10px)';
        messageElement.style.transition = 'all 0.3s ease';
        
        chatbox.appendChild(messageElement);
        chatbox.scrollTop = chatbox.scrollHeight;
        
        // Анимируем появление
        setTimeout(() => {
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateY(0)';
        }, 10);
    }

    clearChat() {
        const chatbox = document.getElementById('chatbox');
        if (chatbox) {
            chatbox.innerHTML = '';
        }
    }

    formatMessage(text) {
        // Простое форматирование текста
        return text
            .replace(/\n/g, '<br>')
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: inherit; text-decoration: underline;">$1</a>');
    }

    formatTime(date) {
        if (!(date instanceof Date)) {
            date = new Date(date);
        }
        return date.toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    playNotificationSound() {
        // Простой звук уведомления
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = context.createOscillator();
            const gainNode = context.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(context.destination);
            
            oscillator.frequency.value = 800;
            gainNode.gain.value = 0.1;
            
            oscillator.start();
            oscillator.stop(context.currentTime + 0.1);
        } catch (error) {
            console.log("Audio not supported");
        }
    }

    copyUserId() {
        navigator.clipboard.writeText(this.myUserId).then(() => {
            this.showSystemMessage("✅ ID скопирован в буфер обмена", "system");
        }).catch(err => {
            this.showSystemMessage("❌ Не удалось скопировать ID", "error");
        });
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
