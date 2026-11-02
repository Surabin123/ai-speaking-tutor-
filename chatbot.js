// Gemini API Configuration
// !!! IMPORTANT: Insert your actual API key here for the chatbot to function.

// System Instruction to guide the AI's persona and tone
const systemPrompt = "You are SmartTalk AI, a friendly, supportive, and knowledgeable chatbot. Your primary goal is to offer helpful suggestions and information using short, simple, and encouraging vocabulary. Keep your responses concise and conversational.";

// UI Elements (These are assumed to be loaded and available when the script runs)
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const sttButton = document.getElementById('stt-button');
const modalContainer = document.getElementById('modal-container');
const modalMessage = document.getElementById('modal-message');
const planTaskButton = document.getElementById('plan-task-button');
const taskPlannerModalContainer = document.getElementById('task-planner-modal-container');
const taskTopicInput = document.getElementById('task-topic-input');
const submitTaskTopicButton = document.getElementById('submit-task-topic');

// --- Utility Functions ---

/**
 * Shows a custom modal with an error message.
 * @param {string} message - The error message to display.
 */
function showCustomAlert(message) {
    modalMessage.textContent = message;
    modalContainer.classList.remove('hidden');
}

/**
 * Scrolls the chat window to the bottom.
 */
function scrollToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

/**
 * Creates and appends a message to the chat window.
 * @param {string} text - The message content.
 * @param {string} sender - 'user' or 'bot'.
 */
function appendMessage(text, sender) {
    const messageContainer = document.createElement('div');
    messageContainer.className = 'flex ' + (sender === 'user' ? 'justify-end' : 'justify-start');

    const textBubble = document.createElement('div');
    textBubble.className = `p-3 rounded-xl max-w-xs md:max-w-md shadow-md ${
        sender === 'user'
            ? 'bg-blue-500 text-white rounded-tr-none'
            : 'bg-gray-200 text-gray-800 rounded-tl-none'
    }`;
    textBubble.innerHTML = text.replace(/\n/g, '<br>');

    if (sender === 'user') {
        messageContainer.appendChild(textBubble);
    } else {
        // For bot replies, add the robot icon
        const botContainer = document.createElement('div');
        botContainer.className = 'flex flex-col items-start';
        botContainer.appendChild(textBubble);

        const icon = document.createElement('div');
        icon.className = 'text-sm mt-1 ml-1 robot-icon';
        icon.textContent = '🤖';

        botContainer.appendChild(icon);
        messageContainer.appendChild(botContainer);
    }

    chatWindow.appendChild(messageContainer);
    scrollToBottom();
}

// --- Core Gemini Logic ---

// AI access stays disabled until requests use a protected server-side endpoint.
async function fetchGemini(_payload, _failMessage) {
    return "AI chat is unavailable until a protected server-side endpoint is configured.";
}

// --- Main Chat Functionality ---

/**
 * Sends the user message to the Gemini API.
 * @param {string} message - The user's input message.
 */
async function getGeminiResponse(message) {
    appendMessage(message, 'user');
    userInput.value = '';
    setLoading(true);

    const payload = {
        contents: [{ parts: [{ text: message }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    const responseText = await fetchGemini(payload, "Sorry, I couldn't connect right now. Please try again.");

    appendMessage(responseText, 'bot');
    setLoading(false);
}

// --- Task Planner Logic ---

/**
 * Generates a step-by-step plan for the given topic.
 * @param {string} topic - The task topic provided by the user.
 */
async function getTaskPlan(topic) {
    appendMessage(`I need a task plan for: **${topic}**`, 'user');
    setLoading(true);

    const planSystemPrompt = "You are SmartTalk AI's Task Planner. Generate a simple, numbered, step-by-step plan for the user's requested topic. The plan must be easy to follow and use short, encouraging vocabulary. Do not add any introductory or concluding sentences. Just output the numbered list.";
    
    const payload = {
        contents: [{ parts: [{ text: topic }] }],
        systemInstruction: { parts: [{ text: planSystemPrompt }] },
    };

    const responseText = await fetchGemini(payload, "Couldn't generate a plan for that right now. Try a simpler topic!");

    // Format response into HTML ordered list for better display
    let formattedResponse = responseText.split('\n')
        .filter(line => line.trim().match(/^\d+\.?\s/))
        .map(line => `<li>${line.replace(/^\d+\.?\s*/, '')}</li>`)
        .join('');
    
    if (formattedResponse) {
        formattedResponse = `<p class="font-semibold">Here is a simple plan for ${topic}:</p><ol class="list-decimal list-inside ml-4 mt-1 space-y-1">${formattedResponse}</ol>`;
    } else {
         formattedResponse = responseText; // Fallback to raw text if formatting failed
    }

    appendMessage(formattedResponse, 'bot');
    setLoading(false);
}

/**
 * Handles the main process of sending a message.
 */
function sendMessage() {
    const message = userInput.value.trim();
    if (message) {
        getGeminiResponse(message);
    } else {
        showCustomAlert("Please enter a message or use the microphone to speak.");
    }
}

/**
 * Sets the loading state by disabling/enabling buttons.
 * @param {boolean} isLoading
 */
function setLoading(isLoading) {
    sendButton.disabled = isLoading;
    sttButton.disabled = isLoading;
    planTaskButton.disabled = isLoading;
    userInput.disabled = isLoading;

    const buttons = [sendButton, sttButton, planTaskButton];
    buttons.forEach(btn => btn.classList.toggle('opacity-50', isLoading));

    if (isLoading) {
         sendButton.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`;
    } else {
         sendButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-send"><path d="m22 2-7 19-9-7L2 13l19-9Z"/><path d="M14.5 10H8.5"/></svg>`;
    }
}


// --- Speech-to-Text (STT) Functionality ---

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        sttButton.classList.remove('bg-green-500');
        sttButton.classList.add('bg-red-500', 'animate-pulse');
        sttButton.title = 'Speaking... Click to stop';
        userInput.placeholder = 'Listening...';
        sendButton.disabled = true;
        planTaskButton.disabled = true;
        userInput.disabled = true;
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        userInput.value = transcript;
        sendMessage();
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        let message = "Speech recognition failed. Please try typing.";
        if (event.error === 'not-allowed') {
            message = "Microphone access denied. Please check your browser settings.";
        } else if (event.error === 'no-speech') {
            message = "No speech detected. Please speak clearly.";
        }
        showCustomAlert(message);
        recognition.stop();
    };

    recognition.onend = () => {
        sttButton.classList.add('bg-green-500');
        sttButton.classList.remove('bg-red-500', 'animate-pulse');
        sttButton.title = 'Speak your message';
        userInput.placeholder = 'Type your message...';
        sendButton.disabled = false;
        planTaskButton.disabled = false;
        userInput.disabled = false;
    };

    sttButton.addEventListener('click', () => {
        try {
            if (sttButton.classList.contains('bg-red-500')) {
                recognition.stop();
            } else {
                recognition.start();
            }
        } catch (e) {
            console.warn("Recognition start failed, might be already running or internal error:", e);
        }
    });

} else {
    // Speech Recognition not supported
    sttButton.disabled = true;
    sttButton.title = 'Speech-to-Text is not supported by your browser.';
}

// --- Event Listeners ---
sendButton.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

planTaskButton.addEventListener('click', () => {
    taskTopicInput.value = '';
    taskPlannerModalContainer.classList.remove('hidden');
    taskTopicInput.focus();
});

submitTaskTopicButton.addEventListener('click', () => {
    const topic = taskTopicInput.value.trim();
    taskPlannerModalContainer.classList.add('hidden');

    if (topic) {
        getTaskPlan(topic);
    } else {
        showCustomAlert("Please enter a task topic to generate a plan.");
    }
});