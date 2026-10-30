package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
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
	if err = os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		return UploadedStorageObject{}, err
	}
	if err = os.WriteFile(name, data, 0600); err != nil {
		return UploadedStorageObject{}, err
	}
	sum := sha256.Sum256(data)
	user, _ := UserFromContext(ctx)
	object := model.StorageObject{ID: id, ProviderID: "local-disk", ObjectKey: key, MimeType: contentType, Bytes: int64(len(data)), SHA256: hex.EncodeToString(sum[:]), CreatedBy: user.ID, CreatedAt: now()}
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
