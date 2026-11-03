package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// The desktop gateway supplies the process-only token. No password or public
// unauthenticated admin endpoint is created for the single local owner.
func EnsureAppOwner() error {
	if config.Cfg.LocalToken == "" {
		return EnsureDefaultAdmin()
	}
	_, exists, err := repository.GetUserByID("local-owner")
	if err != nil || exists {
		return err
	}
	_, err = repository.SaveUser(model.User{ID: "local-owner", Username: "local-owner", DisplayName: "本机工作区", Role: model.UserRoleAdmin, Status: model.UserStatusActive, AffCode: "LOCAL", CreatedAt: now(), UpdatedAt: now()})
	return err
}

func LocalUser() (model.AuthUser, bool) {
	if config.Cfg.LocalToken == "" {
		return model.AuthUser{}, false
	}
	user, found, err := repository.GetUserByID("local-owner")
	return model.PublicUser(user), found && err == nil
}

func LocalObjectPath(key string) (string, error) {
	if config.Cfg.LocalToken == "" || config.Cfg.LocalDataDir == "" || key != filepath.Base(key) || strings.ContainsAny(key, `/\\`) || key == "." || key == ".." {
		return "", errors.New("本机素材路径无效")
	}
	return filepath.Join(config.Cfg.LocalDataDir, "assets", key), nil
}

func uploadLocalObject(ctx context.Context, filename, contentType string, data []byte) (UploadedStorageObject, error) {
	return UploadLocalObjectStream(ctx, filename, contentType, bytes.NewReader(data))
}

const MaxLocalUploadBytes = 1 << 30

func UploadLocalObjectStream(ctx context.Context, filename, contentType string, source io.Reader) (UploadedStorageObject, error) {
	id := uuid.NewString()
	ext := filepath.Ext(filename)
	if len(ext) > 12 || strings.ContainsAny(ext, `/\\`) {
		ext = ""
	}
	key := id + ext
	name, err := LocalObjectPath(key)
	if err != nil {
		return UploadedStorageObject{}, err
	}
	if _, err = os.Stat(config.Cfg.LocalDataDir); err != nil {
		return UploadedStorageObject{}, errors.New("本机数据目录不可用")
	}
	if err = os.Mkdir(filepath.Dir(name), 0755); err != nil && !errors.Is(err, os.ErrExist) {
		return UploadedStorageObject{}, err
	}
	temp, err := os.CreateTemp(filepath.Dir(name), ".upload-*")
	if err != nil {
		return UploadedStorageObject{}, err
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	hash := sha256.New()
	input := &io.LimitedReader{R: source, N: MaxLocalUploadBytes + 1}
	if strings.TrimSpace(contentType) == "" {
		var sample [512]byte
		size, err := io.ReadFull(input, sample[:])
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			return UploadedStorageObject{}, err
		}
		contentType = http.DetectContentType(sample[:size])
		input.R = io.MultiReader(bytes.NewReader(sample[:size]), input.R)
		input.N += int64(size)
	}
	written, err := io.Copy(io.MultiWriter(temp, hash), input)
	if err != nil {
		return UploadedStorageObject{}, err
	}
	if written > MaxLocalUploadBytes {
		return UploadedStorageObject{}, errors.New("本机素材超过 1 GB")
	}
	if err = temp.Close(); err != nil {
		return UploadedStorageObject{}, err
	}
	if err = ctx.Err(); err != nil {
		return UploadedStorageObject{}, err
	}
	if err = os.Rename(temp.Name(), name); err != nil {
		return UploadedStorageObject{}, err
	}
	user, _ := UserFromContext(ctx)
	object := model.StorageObject{ID: id, ProviderID: "local-disk", ObjectKey: key, MimeType: contentType, Bytes: written, SHA256: hex.EncodeToString(hash.Sum(nil)), CreatedBy: user.ID, CreatedAt: now()}
	if _, err = repository.SaveStorageObject(object); err != nil {
		_ = os.Remove(name)
		return UploadedStorageObject{}, err
	}
	return UploadedStorageObject{ID: id, URL: "/api/files/" + id + "/content", StorageKey: "server:" + id, Bytes: object.Bytes, MimeType: contentType}, nil
}

func localObjectStream(object model.StorageObject) (DownloadedStorageObject, error) {
	name, err := LocalObjectPath(object.ObjectKey)
	if err != nil {
		return DownloadedStorageObject{}, err
	}
	file, err := os.Open(name)
	if err != nil {
		return DownloadedStorageObject{}, err
	}
	return DownloadedStorageObject{Object: object, Stream: io.ReadCloser(file), StatusCode: 200, ContentLength: object.Bytes, AcceptRanges: false}, nil
}
