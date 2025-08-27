let socket;
let myUserId = null;
const serverUrl = 'wss://secure-messenger-backend-xjvb.onrender.com'; // ЗАМЕНИТЕ на ваш URL с Render!

// Функция входа в чат
function login() {
    const username = document.getElementById('usernameInput').value;
    if (!username) return alert('Enter username!');

    // Генерируем "уникальный" ID на основе имени и случайных чисел
    myUserId = username + '_' + Math.random().toString(36).substr(2, 5);

    // Показываем наш ID и переключаем вид
    document.getElementById('currentUser').textContent = username;
    document.getElementById('myUserId').textContent = myUserId;
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('chatSection').style.display = 'block';

    connectWebSocket();
}

// Подключение к WebSocket серверу
function connectWebSocket() {
    // Подключаемся к нашему серверу на Render, передаем свой ID
    socket = new WebSocket(`${serverUrl}/ws/${myUserId}`);

    socket.onopen = function(event) {
        addMessageToChatbox('System', 'Connected to secure server!', 'system');
    };

    socket.onmessage = function(event) {
        // Получаем сообщение от сервера
        const messageData = JSON.parse(event.data);
        console.log("Received raw data:", messageData);

        // В РЕАЛЬНОСТИ: Здесь должно быть расшифрование!
        // const decryptedMessage = decrypt(messageData.encrypted_message, myPrivateKey);

        // Для демо просто показываем "зашифрованный" текст
        addMessageToChatbox('Received', `From ${messageData.from}: ${messageData.encrypted_message}`, 'received');
    };

    socket.onclose = function(event) {
        addMessageToChatbox('System', 'Connection closed. Reconnect?', 'system');
    };
}

// Функция отправки сообщения
function sendMessage() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return alert('Not connected to server!');
    }

    const recipientId = document.getElementById('recipientInput').value;
    const messageText = document.getElementById('messageInput').value;

    if (!recipientId || !messageText) return alert('Fill all fields!');

    // В РЕАЛЬНОСТИ: Здесь должно быть шифрование!
    // const encryptedMessage = encrypt(messageText, recipientsPublicKey);

    // Для демо просто имитируем шифрование
    const fakeEncryptedMessage = btoa(messageText); // НЕ ИСПОЛЬЗУЙТЕ btoa для шифрования!

    // Формируем объект сообщения
    const messageData = {
        to: recipientId,
        from: myUserId, // Добавляем отправителя для получателя
        encrypted_message: fakeEncryptedMessage
    };

    // Отправляем сообщение на сервер
    socket.send(JSON.stringify(messageData));

    // Показываем у себя в чате
    addMessageToChatbox('You', `To ${recipientId}: ${messageText}`, 'sent');
    document.getElementById('messageInput').value = '';
}

// Вспомогательная функция для отображения сообщений в чате
function addMessageToChatbox(sender, text, cssClass) {
    const chatbox = document.getElementById('chatbox');
    const messageElement = document.createElement('div');
    messageElement.innerHTML = `<strong>${sender}:</strong> ${text}`;
    messageElement.classList.add(cssClass);
    chatbox.appendChild(messageElement);
    chatbox.scrollTop = chatbox.scrollHeight; // Авто-скролл вниз
}
