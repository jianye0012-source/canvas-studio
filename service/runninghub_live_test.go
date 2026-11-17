//go:build live

package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestRunningHubBaseURLNormalization(t *testing.T) {
	cases := map[string]string{
		"":                                 "https://www.runninghub.cn",
		"https://www.runninghub.cn":        "https://www.runninghub.cn",
		"https://www.runninghub.cn/":       "https://www.runninghub.cn",
		"https://www.runninghub.ai":        "https://www.runninghub.ai",
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

func TestRunningHubLiveConnectivity(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	body := map[string]any{"apiKey": "invalid-test-key-123", "workflowId": "123"}
	encoded, _ := json.Marshal(body)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://www.runninghub.cn/api/openapi/getJsonApiFormat", bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")

	start := time.Now()
	response, err := SafeProxyHTTPClient().Do(request)
	if err != nil {
		t.Fatalf("SafeProxyHTTPClient raw error: %v (after %s)", err, time.Since(start))
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	t.Logf("status=%d body=%s elapsed=%s", response.StatusCode, string(data), time.Since(start))

	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("non-JSON response: %v", err)
	}
	if code, ok := runningHubResponseCode(parsed); !ok || code == 0 {
		t.Fatalf("expected a non-zero RunningHub business code, got code=%d ok=%v body=%s", code, ok, string(data))
	}
}

func TestRunningHubRequestLiveSwallowsError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var response map[string]any
	err := runningHubRequest(ctx, "https://www.runninghub.cn/api/openapi/getJsonApiFormat", map[string]any{"apiKey": "invalid-test-key-123", "workflowId": "123"}, &response, nil)
	if err != nil {
		t.Logf("runningHubRequest wrapped error: %v", err)
		return
	}
	code, _ := runningHubResponseCode(response)
	t.Logf("runningHubRequest ok, business code=%d", code)
}

func TestRunningHubAppInspectProtocol(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	postBody, _ := json.Marshal(map[string]any{"apiKey": "invalid-test-key-123", "webappId": "123"})
	postReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://www.runninghub.cn/api/webapp/apiCallDemo", bytes.NewReader(postBody))
	postReq.Header.Set("Content-Type", "application/json")
	postResp, err := SafeProxyHTTPClient().Do(postReq)
	if err != nil {
		t.Fatalf("POST apiCallDemo error: %v", err)
	}
	postData, _ := io.ReadAll(io.LimitReader(postResp.Body, 1<<20))
	postResp.Body.Close()

	getReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.runninghub.cn/api/webapp/apiCallDemo", nil)
	getReq.URL.RawQuery = url.Values{"apiKey": []string{"invalid-test-key-123"}, "webappId": []string{"123"}}.Encode()
	getResp, err := SafeProxyHTTPClient().Do(getReq)
	if err != nil {
		t.Fatalf("GET apiCallDemo error: %v", err)
	}
	getData, _ := io.ReadAll(io.LimitReader(getResp.Body, 1<<20))
	getResp.Body.Close()

	t.Logf("POST status=%d body=%s", postResp.StatusCode, string(postData))
	t.Logf("GET  status=%d body=%s", getResp.StatusCode, string(getData))
	var postParsed, getParsed map[string]any
	_ = json.Unmarshal(postData, &postParsed)
	_ = json.Unmarshal(getData, &getParsed)
	if code, _ := runningHubDirectCode(postParsed); code != 301 {
		t.Fatalf("POST apiCallDemo expected business code 301 PARAMS_INVALID, got %v", postParsed)
	}
	if code, _ := runningHubDirectCode(getParsed); code != 332 {
		t.Fatalf("GET apiCallDemo expected business code 332 USER_DOES_NOT_EXIST, got %v", getParsed)
	}
}

func TestRunningHubAppSubmitRequiresNodeInfoList(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// 官方 TaskRunWebappByKeyRequest schema 把 nodeInfoList 标记为 required。
	// 后端修复后应始终带上 nodeInfoList（即使为空数组），这里验证该请求体能
	// 通过参数校验并进入 apiKey 校验（无效 key → code 301 user not exist）。
	body := map[string]any{"apiKey": "invalid-test-key-123", "webappId": "123", "nodeInfoList": []map[string]string{}}
	encoded, _ := json.Marshal(body)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://www.runninghub.cn/task/openapi/ai-app/run", bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := SafeProxyHTTPClient().Do(request)
	if err != nil {
		t.Fatalf("ai-app/run error: %v", err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	t.Logf("status=%d body=%s", response.StatusCode, string(data))
	var parsed map[string]any
	_ = json.Unmarshal(data, &parsed)
	code, _ := runningHubDirectCode(parsed)
	if code != 301 || !strings.Contains(string(data), "user not exist") {
		t.Fatalf("expected apiKey validation to be reached (301 user not exist), got code=%d body=%s", code, string(data))
	}
}
