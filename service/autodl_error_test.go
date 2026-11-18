package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

type autodlErrorTransport func(*http.Request) (*http.Response, error)

func (transport autodlErrorTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestReadAutoDLMetadataErrorRedacted(t *testing.T) {
	original := safeProxyHTTPClient
	t.Cleanup(func() { safeProxyHTTPClient = original })
	safeProxyHTTPClient = &http.Client{Transport: autodlErrorTransport(func(request *http.Request) (*http.Response, error) {
		return nil, errors.New("dial tcp: connection refused")
	})}
	_, err := readAutoDLMetadata("http://127.0.0.1:1", "/workflows", nil)
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), "127.0.0.1") || strings.Contains(err.Error(), "?token=") {
		t.Fatalf("error leaked URL: %v", err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "refused") {
		t.Fatalf("error should keep underlying cause: %v", err)
	}
}

func TestWaitAutoDLAudioErrorRedacted(t *testing.T) {
	channel := model.ModelChannel{BaseURL: "http://127.0.0.1:1/v1?token=SECRET"}
	payload := []byte(`{"code":"Success","data":{"task_id":"123"}}`)
	_, err := WaitAutoDLAudio(context.Background(), channel, payload)
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), "SECRET") || strings.Contains(err.Error(), "?token=") {
		t.Fatalf("error leaked query: %v", err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "connect") && !strings.Contains(strings.ToLower(err.Error()), "refused") {
		t.Fatalf("error should keep underlying cause: %v", err)
	}
}
