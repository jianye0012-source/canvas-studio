package middleware

import (
	"crypto/subtle"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/config"
)

func LocalGateway(c *gin.Context) {
	if config.Cfg.LocalToken != "" && subtle.ConstantTimeCompare([]byte(c.GetHeader("X-Canvas-Local-Token")), []byte(config.Cfg.LocalToken)) != 1 {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	if config.Cfg.LocalToken != "" {
		info, err := os.Stat(config.Cfg.LocalDataDir)
		if err != nil || !info.IsDir() {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": 1, "data": nil, "msg": "机械盘数据目录不可用，请恢复磁盘后重试"})
			return
		}
	}
	c.Next()
}
