package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const RunningHubStandardProtocol = "runninghub-standard"
const RunningHubStandardImageEndpoint = "/runninghub/submit"

var runningHubStandardTaskIDPattern = regexp.MustCompile(`^[0-9]{1,32}$`)

type runningHubStandardResult struct {
	TaskID       string `json:"taskId"`
	Status       string `json:"status"`
	ErrorMessage string `json:"errorMessage"`
	ErrorCode    string `json:"errorCode"`
	Error        struct {
		Message string `json:"message"`
	} `json:"error"`
	Results []struct {
		URL string `json:"url"`
	} `json:"results"`
}

func runningHubStandardProviderID(task model.CanvasImageTask) string {
	var response runningHubStandardResult
	if json.Unmarshal([]byte(task.ResponseBody), &response) == nil && runningHubStandardTaskIDPattern.MatchString(response.TaskID) {
		return response.TaskID
	}
	return ""
}

func runningHubStandardRequest(ctx context.Context, channel model.ModelChannel, endpoint string, body []byte) (runningHubStandardResult, error) {
	var result runningHubStandardResult
	// The gateway port and token change on restart before saved settings refresh.
	if config.Cfg.LocalProviderBase != "" && config.Cfg.LocalProviderToken != "" {
		origin, err := url.Parse(config.Cfg.LocalProviderBase)
		if err != nil {
			return result, errors.New("本机 RunningHub 网关地址无效")
		}
		origin.Path = "/local-ai/channels/" + channel.ID
		channel.BaseURL, channel.APIKey = origin.String(), config.Cfg.LocalProviderToken
	}
	base, err := url.Parse(channel.BaseURL)
	if config.Cfg.LocalToken == "" || channel.Protocol != RunningHubStandardProtocol || err != nil ||
		base.Scheme != "http" || base.Hostname() != "127.0.0.1" || base.User != nil || base.RawQuery != "" || base.Fragment != "" ||
		!strings.HasPrefix(base.Path, "/local-ai/channels/") {
		return result, errors.New("RunningHub 标准模型需要从本机启动器配置")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, BuildModelChannelURL(channel, endpoint), bytes.NewReader(body))
	if err != nil {
		return result, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	timeout := 45 * time.Second
	if endpoint == RunningHubStandardImageEndpoint {
		timeout = 5 * time.Minute
	}
	client := &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return result, errors.New("无法连接本机 RunningHub 渠道")
	}
	defer response.Body.Close()
	if err := json.NewDecoder(io.LimitReader(response.Body, 1024*1024)).Decode(&result); err != nil {
		return result, errors.New("RunningHub 响应无法解析")
	}
	if response.StatusCode != http.StatusOK {
		return result, errors.New(firstVideoTaskValue(result.Error.Message, fmt.Sprintf("RunningHub 返回 HTTP %d", response.StatusCode)))
	}
	return result, nil
}

func SubmitRunningHubStandardImage(ctx context.Context, task model.CanvasImageTask, channel model.ModelChannel, body []byte) error {
	if task.ContentType != "application/json" {
		return errors.New("RunningHub 图片任务格式无效")
	}
	result, err := runningHubStandardRequest(ctx, channel, RunningHubStandardImageEndpoint, body)
	if err != nil {
		return fmt.Errorf("%w；重试前请先核对 RunningHub 任务记录", err)
	}
	if strings.EqualFold(result.Status, "FAILED") || !runningHubStandardTaskIDPattern.MatchString(result.TaskID) {
		return errors.New(firstVideoTaskValue(result.ErrorMessage, result.ErrorCode, "RunningHub 未返回有效任务编号，请核对任务记录后再重试"))
	}
	checkpoint, _ := json.Marshal(map[string]string{"taskId": result.TaskID})
	task.ResponseBody = string(checkpoint)
	task.Progress = 20
	_, err = SaveCanvasImageTask(task)
	return err
}

func pollRunningHubStandardImage(ctx context.Context, task model.CanvasImageTask) error {
	id := runningHubStandardProviderID(task)
	started, _ := time.Parse(time.RFC3339, task.StartedAt)
	if !started.IsZero() && time.Since(started) > 24*time.Hour {
		return failRunningHubStandardImage(task, "RunningHub 任务超过等待时间，请在服务商任务记录中核对")
	}
	channel, err := SelectModelChannelForModel(task.Model, task.ChannelID, false)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]string{"taskId": id})
	result, err := runningHubStandardRequest(ctx, channel, "/runninghub/query", body)
	if err != nil {
		return err
	}
	if result.TaskID != id {
		return errors.New("RunningHub 返回了不匹配的任务编号")
	}
	switch strings.ToUpper(result.Status) {
	case "CREATE", "QUEUED", "RUNNING":
		return nil
	case "FAILED", "CANCEL", "CANCELLED":
		return failRunningHubStandardImage(task, firstVideoTaskValue(result.ErrorMessage, result.ErrorCode, "RunningHub 图片任务失败"))
	case "SUCCESS":
		if len(result.Results) == 0 || result.Results[0].URL == "" {
			return failRunningHubStandardImage(task, "RunningHub 任务完成但没有返回图片")
		}
	default:
		return errors.New("RunningHub 返回未知任务状态")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, result.Results[0].URL, nil)
	if err != nil || request.URL.Scheme != "https" {
		return failRunningHubStandardImage(task, "RunningHub 返回的图片地址无效")
	}
	response, err := SafeProxyHTTPClient().Do(request)
	if err != nil {
		return errors.New("无法下载 RunningHub 生成的图片，将继续尝试")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("下载 RunningHub 图片失败，HTTP %d", response.StatusCode)
	}
	reader := bufio.NewReader(response.Body)
	prefix, _ := reader.Peek(512)
	contentType := http.DetectContentType(prefix)
	extension := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}[contentType]
	if extension == "" {
		return failRunningHubStandardImage(task, "RunningHub 返回的文件格式无法作为图片保存")
	}
	stored, err := UploadLocalObjectStream(WithUser(ctx, model.AuthUser{ID: task.UserID}), "RunningHub"+extension, contentType, reader)
	if err != nil {
		return err
	}
	task.ImageURL, task.StorageKey, task.MimeType, task.Bytes = stored.URL, stored.StorageKey, stored.MimeType, stored.Bytes
	task.Status, task.Progress, task.CompletedAt = "completed", 100, now()
	_, err = SaveCanvasImageTask(task)
	return err
}

func failRunningHubStandardImage(task model.CanvasImageTask, message string) error {
	task.Status, task.CompletedAt, task.Error = "failed", now(), message
	_, err := SaveCanvasImageTask(task)
	return err
}

func PollRunningHubStandardVideo(ctx context.Context, task model.VideoTask, channel model.ModelChannel) (VideoTaskPollUpdate, error) {
	id := task.UpstreamTaskID
	if !runningHubStandardTaskIDPattern.MatchString(id) {
		return VideoTaskPollUpdate{Status: "failed", Error: "RunningHub 视频任务编号无效"}, nil
	}
	created, _ := time.Parse(time.RFC3339, task.CreatedAt)
	if !created.IsZero() && time.Since(created) > 24*time.Hour {
		return VideoTaskPollUpdate{Status: "failed", Error: "RunningHub 任务超过等待时间，请在服务商任务记录中核对"}, nil
	}
	body, _ := json.Marshal(map[string]string{"taskId": id})
	result, err := runningHubStandardRequest(ctx, channel, "/runninghub/query", body)
	if err != nil {
		return VideoTaskPollUpdate{}, err
	}
	if result.TaskID != id {
		return VideoTaskPollUpdate{}, errors.New("RunningHub 返回了不匹配的任务编号")
	}
	switch strings.ToUpper(result.Status) {
	case "CREATE", "QUEUED":
		return VideoTaskPollUpdate{Status: "queued"}, nil
	case "RUNNING":
		return VideoTaskPollUpdate{Status: "running"}, nil
	case "FAILED", "CANCEL", "CANCELLED":
		return VideoTaskPollUpdate{Status: "failed", Error: firstVideoTaskValue(result.ErrorMessage, result.ErrorCode, "RunningHub 视频生成失败")}, nil
	case "SUCCESS":
	default:
		return VideoTaskPollUpdate{}, errors.New("RunningHub 返回未知视频任务状态")
	}
	if len(result.Results) == 0 || result.Results[0].URL == "" {
		return VideoTaskPollUpdate{Status: "failed", Error: "RunningHub 未返回视频文件"}, nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, result.Results[0].URL, nil)
	if err != nil || request.URL.Scheme != "https" {
		return VideoTaskPollUpdate{Status: "failed", Error: "RunningHub 返回的视频地址无效"}, nil
	}
	response, err := SafeProxyHTTPClient().Do(request)
	if err != nil {
		return VideoTaskPollUpdate{}, errors.New("无法下载 RunningHub 生成的视频，将继续尝试")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return VideoTaskPollUpdate{}, fmt.Errorf("下载 RunningHub 视频失败，HTTP %d", response.StatusCode)
	}
	reader := bufio.NewReader(response.Body)
	prefix, _ := reader.Peek(512)
	contentType := http.DetectContentType(prefix)
	extension := map[string]string{"video/mp4": ".mp4", "video/webm": ".webm"}[contentType]
	if extension == "" {
		return VideoTaskPollUpdate{Status: "failed", Error: "RunningHub 返回的文件格式无法作为视频保存"}, nil
	}
	stored, err := UploadLocalObjectStream(WithUser(ctx, model.AuthUser{ID: task.UserID}), "RunningHub"+extension, contentType, reader)
	if err != nil {
		return VideoTaskPollUpdate{}, err
	}
	return VideoTaskPollUpdate{Status: "completed", Progress: 100, VideoURL: stored.URL}, nil
}

func resumeRunningHubStandardImageTasks() error {
	if config.Cfg.LocalToken == "" {
		return nil
	}
	return repository.MarkUnconfirmedImageSubmissions(RunningHubStandardImageEndpoint, now())
}
