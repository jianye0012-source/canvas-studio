package handler

import (
	"net/http"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func PoseGallery(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	result, err := service.ListPoseRefs(model.PoseRefQuery{Query: parseQuery(r), Kind: q.Get("kind"), Group: q.Get("group"), Angle: q.Get("angle"), Safe: q.Get("safe") != "0"})
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func PoseGalleryFile(w http.ResponseWriter, r *http.Request, name string) {
	path, ok := service.PoseGalleryFilePath(name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, path)
}
