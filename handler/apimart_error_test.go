package handler

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestPollAPIMartImageTaskErrorRedacted(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "http://example.test", nil)
	channel := model.ModelChannel{BaseURL: "http://127.0.0.1:1/v1?token=SECRET", APIKey: "k"}
	_, message := pollAPIMartImageTask(request, channel, "task-1")
	if message == "" {
		t.Fatal("expected error message")
	}
	if strings.Contains(message, "SECRET") || strings.Contains(message, "?token=") {
		t.Fatalf("error leaked query: %q", message)
	}
	if !strings.Contains(strings.ToLower(message), "connect") && !strings.Contains(strings.ToLower(message), "refused") {
		t.Fatalf("error should keep underlying cause: %q", message)
	}
}

func TestUploadAPIMartImageBytesErrorRedacted(t *testing.T) {
	var logOutput bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&logOutput)
	t.Cleanup(func() { log.SetOutput(originalWriter) })

	channel := model.ModelChannel{BaseURL: "http://127.0.0.1:1/v1?token=SECRET", APIKey: "k"}
	_, err := uploadAPIMartImageBytes(channel, []byte("png"), "x.png", "image/png")
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), "SECRET") || strings.Contains(err.Error(), "?token=") {
		t.Fatalf("error leaked query: %v", err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "connect") && !strings.Contains(strings.ToLower(err.Error()), "refused") {
		t.Fatalf("error should keep underlying cause: %v", err)
	}
	if strings.Contains(logOutput.String(), "SECRET") || strings.Contains(logOutput.String(), "?token=") {
		t.Fatalf("log leaked query: %s", logOutput.String())
	}
}
