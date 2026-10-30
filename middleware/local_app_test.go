package middleware

import (
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/config"
)

func TestLocalGatewayRequiresTokenAndMountedData(t *testing.T) {
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })
	directory := t.TempDir()
	config.Cfg.LocalToken, config.Cfg.LocalDataDir = "process-token", directory
	router := gin.New()
	router.Use(LocalGateway)
	router.GET("/health", func(c *gin.Context) { c.Status(200) })
	request := func(token string) int {
		req := httptest.NewRequest("GET", "/health", nil)
		req.Header.Set("X-Canvas-Local-Token", token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response.Code
	}
	if code := request(""); code != 403 {
		t.Fatalf("untrusted request: %d", code)
	}
	if code := request("process-token"); code != 200 {
		t.Fatalf("mounted directory: %d", code)
	}
	if err := os.Remove(directory); err != nil {
		t.Fatal(err)
	}
	if code := request("process-token"); code != 503 {
		t.Fatalf("missing directory: %d", code)
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatal("missing data directory was recreated")
	}
}
