package service

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestRunningHubBaseURLNormalization(t *testing.T) {
	cases := map[string]string{
		"":                                     "https://www.runninghub.cn",
		"https://www.runninghub.cn":            "https://www.runninghub.cn",
		"https://www.runninghub.cn/":           "https://www.runninghub.cn",
		"https://www.runninghub.ai":            "https://www.runninghub.ai",
		"https://www.runninghub.cn/openapi/v2": "https://www.runninghub.cn",
		"https://www.runninghub.cn/openapi":    "https://www.runninghub.cn",
		"https://www.runninghub.ai/openapi/v2": "https://www.runninghub.ai",
	}
	for input, want := range cases {
		got, err := runningHubBaseURL(input)
		if err != nil {
			t.Fatalf("runningHubBaseURL(%q) error: %v", input, err)
		}
		if got != want {
			t.Fatalf("runningHubBaseURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestRunningHubGetRequestDoesNotLeakAPIKey(t *testing.T) {
	original := safeProxyHTTPClient
	t.Cleanup(func() { safeProxyHTTPClient = original })
	safeProxyHTTPClient = &http.Client{Transport: runningHubTestTransport(func(request *http.Request) (*http.Response, error) {
		return nil, errors.New("dial tcp 127.0.0.1:1: connect: connection refused")
	})}
	const secret = "SECRET_API_KEY_SHOULD_NOT_LEAK"
	var target map[string]any
	err := runningHubGetRequest(context.Background(), "https://www.runninghub.cn/api/webapp/apiCallDemo", url.Values{"apiKey": []string{secret}, "webappId": []string{"123"}}, &target)
	if err == nil {
		t.Fatal("expected connection error")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaks apiKey: %v", err)
	}
	if !strings.Contains(err.Error(), "connection refused") {
		t.Fatalf("error should preserve underlying cause: %v", err)
	}
}
