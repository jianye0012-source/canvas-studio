package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestFailAIChannelSelectPassesNoChannelMessage(t *testing.T) {
	recorder := httptest.NewRecorder()
	failAIChannelSelect(recorder, errors.New("没有可用模型渠道"), "AI 接口请求失败")
	if msg := decodeFailMessage(t, recorder); msg != "没有可用模型渠道" {
		t.Fatalf("expected channel message to pass through, got %q", msg)
	}

	recorder = httptest.NewRecorder()
	failAIChannelSelect(recorder, errors.New("database is locked"), "AI 接口请求失败")
	if msg := decodeFailMessage(t, recorder); msg != "AI 接口请求失败" {
		t.Fatalf("expected fallback message, got %q", msg)
	}
}

func TestCopyAIResponseNetworkErrorHasCauseWithoutURL(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "http://127.0.0.1:1/v1/chat/completions?key=SECRET-KEY", nil)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	copyAIResponse(recorder, request, model.ModelChannel{}, aiLogContext{}, nil)
	msg := decodeFailMessage(t, recorder)
	if !strings.HasPrefix(msg, "AI 接口请求失败：") {
		t.Fatalf("expected network cause prefix, got %q", msg)
	}
	lower := strings.ToLower(msg)
	if !strings.Contains(lower, "connect") && !strings.Contains(lower, "refused") {
		t.Fatalf("expected network cause in message, got %q", msg)
	}
	if strings.Contains(msg, "SECRET-KEY") || strings.Contains(msg, "127.0.0.1:1/v1") {
		t.Fatalf("network error leaked URL: %q", msg)
	}
}

func decodeFailMessage(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Msg string `json:"msg"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode fail response: %v", err)
	}
	return body.Msg
}
