let currentModel = null;
let chatHistory = {};

const modelInfo = {
    qwen3: { name: 'Qwen3-1.7B', desc: 'Fast Thinking' },
    lfm2: { name: 'LFM2-VL-1.6B ', desc: 'Very Fast' },
    phi4: { name: 'Phi-4-4B', desc: 'Good Responses' },
    gemma: { name: 'Gemma-3-4B', desc: 'Best Responses' }
};

async function compareModels() {
    const selectedModels = getSelectedModels();
    const message = document.getElementById('initialMessage').value.trim();
    
    if (!message) {
        alert('Please enter a question to compare models');
        return;
    }
    
    if (selectedModels.length === 0) {
        alert('Please select at least one model');
        return;
    }
    
    document.getElementById('comparisonResults').classList.remove('hidden');
    const responsesContainer = document.getElementById('modelResponses');
    responsesContainer.innerHTML = '';
    
    // Initialize chat history for selected models
    selectedModels.forEach(model => {
        chatHistory[model] = [{ role: 'user', content: message }];
    });
    
    selectedModels.forEach(model => {
        const responseDiv = createModelResponseContainer(model);
        responsesContainer.appendChild(responseDiv);
    });
    
    const promises = selectedModels.map(model => streamToModel(model, message, `response-${model}`));
    await Promise.all(promises);
}

function getSelectedModels() {
    const checkboxes = document.querySelectorAll('input[name="models"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function createModelResponseContainer(model) {
    const div = document.createElement('div');
    div.className = 'model-response';
    div.innerHTML = `
        <div class="response-header">
            <span class="model-name">${modelInfo[model].name}</span>
            <button class="chat-button" data-model="${model}">
                Continue Chat
            </button>
             <button class="stop-button hidden" data-container="response-${model}">
                Stop
            </button>
        </div>
        <div id="thinking-response-${model}" class="thinking-response-content">
        </div>
        <div id="response-${model}" class="response-content">
            <div class="typing-indicator">Working...</div>
        </div>
    `;

    const chatButton = div.querySelector('.chat-button');
    const stopButton = div.querySelector('.stop-button');

    chatButton.addEventListener('click', function() {
        startIndividualChat(model);
    });
    
    stopButton.addEventListener('click', function() {
        stopGeneration(`response-${model}`);
    });

    return div;
}

function stopGeneration(containerId) {
    const controller = activeControllers.get(containerId);
    if (controller) {
        controller.abort();
        activeControllers.delete(containerId);
    }
}
const activeControllers = new Map();

async function streamToModel(model, message, containerId) {
    const container = document.getElementById(containerId);
    const thinkingContainer = document.getElementById("thinking-"+containerId);
    const modelResponse = container.closest('.model-response');
    modelResponse.classList.add('streaming');
    const stopButton = modelResponse.querySelector('.stop-button');
    const chatButton = modelResponse.querySelector('.chat-button');
    
    // Show stop button, hide chat button while streaming
    stopButton.classList.remove('hidden');
    chatButton.classList.add('hidden');
    modelResponse.classList.add('streaming');

    const controller = new AbortController();
    activeControllers.set(containerId, controller);
    
    try {
        const response = await fetch('http://ai.meng.zip:5000/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                messages: [{ role: 'user', content: message }],
                max_tokens: 1000, //hardcoded here
                temperature: 0.7,
                model: model
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        container.innerHTML = '';
        thinkingContainer.innerHTML = '';
        let responseText = '';
        let thinkingResponseText = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            if (controller.signal.aborted) {
                break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            console.log(lines)

            for (const line of lines) {
                if (line.trim() === '' || line.includes('[DONE]')) continue;
                
                if (line.startsWith('data: ')) {
                    try {
                        const jsonStr = line.slice(6);
                        const data = JSON.parse(jsonStr);
                        
                        const content = data.choices[0]?.delta?.content || '';
                        if (content) {
                            responseText += content;
                            container.innerHTML = formatMessage(responseText);
                        }
                        const thinkingContent = data.choices[0]?.delta?.reasoning_content || '';
                        if (thinkingContent) {
                            thinkingResponseText += thinkingContent;
                            thinkingContainer.innerHTML = `Thinking... ${formatMessage(thinkingResponseText)} `;
                        }
                    } catch (e) {
                        // Skip
                    }
                }
            }
        }
        
        // Add AI response to chat history
        if (chatHistory[model]) {
            chatHistory[model].push({ role: 'assistant', content: responseText });
        }
        
    } catch (error) {
        if (error.name === 'AbortError') {
            container.innerHTML = container.innerHTML + '...Generation stopped';
        }else{
            container.innerHTML = `Error: ${error.message}`;
        }
    } finally {
        activeControllers.delete(containerId);
        modelResponse.classList.remove('streaming');
        stopButton.classList.add('hidden');
        chatButton.classList.remove('hidden');
    }
}

function startIndividualChat(model) {
    currentModel = model;
    
    // Hide comparison, show individual chat
    document.getElementById('modelSelection').classList.add('hidden');
    document.getElementById('comparisonResults').classList.add('hidden');
    document.getElementById('individualChat').classList.remove('hidden');
    
    // Set chat header
    document.getElementById('currentModelName').textContent = `Chat with ${modelInfo[model].name}`;
    displayChatHistory(model);
}

function displayChatHistory(model) {
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = '';
    
    if (chatHistory[model]) {
        chatHistory[model].forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${msg.role}`;
            messageDiv.innerHTML = formatMessage(msg.content);
            messagesContainer.appendChild(messageDiv);
        });
    }
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendIndividualMessage() {
    if (!currentModel) return;
    
    const messageInput = document.getElementById('chatMessage');
    const message = messageInput.value.trim();
    
    if (!message) return;
    
    // Add user message to history and display
    chatHistory[currentModel].push({ role: 'user', content: message });
    displayChatHistory(currentModel);
    messageInput.value = '';
    
    // Create assistant message placeholder
    const messagesContainer = document.getElementById('chatMessages');
    const messageContainer = document.getElementById('chatMessage');
    const thinkingAssistantDiv = document.createElement('div');
    const assistantDiv = document.createElement('div');
    assistantDiv.className = 'chat-message assistant';
    thinkingAssistantDiv.className = 'thinking-response-content';
    assistantDiv.innerHTML = '<div class="typing-indicator">Working...</div>';
    messagesContainer.appendChild(thinkingAssistantDiv);
    messagesContainer.appendChild(assistantDiv);

    const controller = new AbortController();
    const streamId = `individual-${Date.now()}`;
    activeControllers.set(streamId, controller);
    
    try {
        const response = await fetch('https://ai.meng.zip:5000/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                messages: chatHistory[currentModel],
                max_tokens: 1000, //again, hardcoded on the backend anyways
                temperature: 0.7,
                model: currentModel
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        let responseText = '';
        let thinkingResponseText = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.trim() === '' || line.includes('[DONE]')) continue;
                
                if (line.startsWith('data: ')) {
                    try {
                        const jsonStr = line.slice(6);
                        const data = JSON.parse(jsonStr);
                        
                        const content = data.choices[0]?.delta?.content || '';
                        if (content) {
                            responseText += content;
                            assistantDiv.innerHTML = formatMessage(responseText);
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        }
                        const thinkingContent = data.choices[0]?.delta?.reasoning_content || '';
                          if (thinkingContent) {
                            thinkingResponseText += thinkingContent;
                            thinkingAssistantDiv.innerHTML = `Thinking... ${formatMessage(thinkingResponseText)} `;
                        }
                    } catch (e) {
                        // Skip
                    }
                }
            }
        }
        
        // Add to chat history
        chatHistory[currentModel].push({ role: 'assistant', content: responseText });
        
    } catch (error) {
         if (error.name === 'AbortError') {
            assistantDiv.innerHTML = '<span style="color: orange;">Generation stopped</span>';
        } else {
        assistantDiv.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
        }
    } finally {
        activeControllers.delete(streamId);
    }
}

function backToComparison() {
    document.getElementById('modelSelection').classList.remove('hidden');
    document.getElementById('comparisonResults').classList.remove('hidden');
    document.getElementById('individualChat').classList.add('hidden');
    currentModel = null;
}

function formatMessage(content) {
    const { Marked } = globalThis.marked;
    const { markedHighlight } = globalThis.markedHighlight;
    const markedNew = new Marked(
        markedHighlight({
	        emptyLangClass: 'hljs',
            langPrefix: 'hljs language-',
            highlight(code, lang, info) {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            }
        })
    );

    return markedNew.parse(content);
}


document.addEventListener('DOMContentLoaded', function() {

    document.getElementById('askQuestionBtn').addEventListener('click', compareModels);
    document.getElementById('backToComparisonBtn').addEventListener('click', backToComparison);
    document.getElementById('sendMessageBtn').addEventListener('click', sendIndividualMessage);
    
    // Enter key support
    document.getElementById('initialMessage').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') compareModels();
    });
    
    document.getElementById('chatMessage').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') sendIndividualMessage();
    });
});

