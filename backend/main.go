package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

type StreamRequest struct {
	Messages    []ChatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens"`
	Temperature float64       `json:"temperature"`
	Stream      bool          `json:"stream"`
	Model       string        `json:"model,omitempty"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type StreamResponse struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
			Role    string `json:"role,omitempty"`
		} `json:"delta"`
		Index        int    `json:"index"`
		FinishReason string `json:"finish_reason,omitempty"`
	} `json:"choices"`
	Model string `json:"model,omitempty"`
}

// add/remove models here
var models = map[string]string{
	"qwen3": "http://192.168.129.107:8004/v1/chat/completions",
	"lfm2":  "http://192.168.129.109:8004/v1/chat/completions",
	"phi4":  "http://192.168.129.111:8004/v1/chat/completions",
	"gemma": "http://192.168.129.110:8004/v1/chat/completions",
}

//////////
//HELPERS
/////////

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*") //CHANGE THIS IN PRODUCTION
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

// Set the default system prompt here
func createSystemMessage() ChatMessage {
	return ChatMessage{
		Role:    "system",
		Content: "You are an AI assistant running locally on ai.meng.zip infrastructure using modest hardware resources. Current date: Sunday, August 24, 2025. Provide complete, accurate information in concise responses - include all necessary details but keep explanations brief and well-structured to optimize performance. Be direct and efficient while ensuring your answers are fully helpful.",
	}
}

func streamChatToHTTP(w http.ResponseWriter, messages []ChatMessage, modelEndpoint string, maxTokens int, modelType string) error {

	request := StreamRequest{
		Messages:    messages,
		MaxTokens:   2000, //manually define these (set in backend anyway)
		Temperature: 0.7,
		Stream:      true,
	}

	jsonData, err := json.Marshal(request)
	if err != nil {
		return err
	}

	resp, err := http.Post(modelEndpoint, "application/json", strings.NewReader(string(jsonData)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming not supported")
	}

	scanner := bufio.NewScanner(resp.Body)
	startTime := time.Now()
	tokenCount := 0
	log.Printf("Stream Started on %s", modelType)

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" {
			continue
		}

		if strings.Contains(line, "[DONE]") {
			fmt.Fprintf(w, "%s\n", line)
			flusher.Flush()
			break
		}

		if strings.HasPrefix(line, "data: ") {
			jsonStr := line[6:] // Remove "data: " prefix

			var streamResp StreamResponse
			err := json.Unmarshal([]byte(jsonStr), &streamResp)
			if err != nil {
				continue
			}

			// Forward the complete line to frontend, might want to change this in the future
			fmt.Fprintf(w, "%s\n", line)
			flusher.Flush()

			if len(streamResp.Choices) > 0 {
				content := streamResp.Choices[0].Delta.Content
				if content != "" {
					tokenCount++
				}
			}
		} else {
			fmt.Fprintf(w, "%s\n", line)
			flusher.Flush()
		}
	}

	duration := time.Since(startTime)
	log.Printf("Stream completed on %s in %.2f seconds (%d tokens, %.1f tokens/sec)", modelType, duration.Seconds(), tokenCount, float64(tokenCount)/duration.Seconds())

	return scanner.Err()
}

//////////
//HANDLERS
/////////

func modelsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		return
	}

	modelInfo := map[string]map[string]string{
		"qwen3": {"name": "Qwen3-0.6B", "description": "Fast Thinking"},
		"lfm2":  {"name": "LFM2-VL-1.6B-Q4_0", "description": "Fast"},
		"phi4":  {"name": "Phi-4-4B", "description": "Good Responses"},
		"gemma": {"name": "Gemma-3-4B", "description": "Best Responses"},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(modelInfo)
}

func chatHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request
	var req StreamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Model == "" {
		http.Error(w, "No model selected", http.StatusBadRequest)
		return
	}

	modelEndpoint, exists := models[req.Model]
	if !exists {
		http.Error(w, "Model not found", http.StatusBadRequest)
		return
	}

	// Add system message if not present
	if len(req.Messages) == 0 || req.Messages[0].Role != "system" {
		req.Messages = append([]ChatMessage{createSystemMessage()}, req.Messages...)
	}

	// Set streaming headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	err := streamChatToHTTP(w, req.Messages, modelEndpoint, req.MaxTokens, req.Model)
	if err != nil {
		log.Printf("Streaming error: %v", err)
	}
}

//////
//MAIN
/////

func main() {
	http.HandleFunc("/v1/chat/completions", chatHandler)
	http.HandleFunc("/v1/models", modelsHandler)

	port := ":5000"
	fmt.Printf("Running ai.meng.zip backend on http://localhost%s\n", port)
	fmt.Println("Available models: qwen3, lfm2, phi4, gemma")

	log.Fatal(http.ListenAndServe(port, nil))
}
