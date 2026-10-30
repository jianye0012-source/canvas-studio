package main

import (
	"io"
	"log"
	"os"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/router"
	"github.com/tigerowo/infinite-canvas/service"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if config.Cfg.LocalToken != "" {
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); os.Exit(0) }()
	}
	if err := service.EnsureAppOwner(); err != nil {
		log.Fatal(err)
	}
	if err := service.EnsureDefaultAgentSkills(); err != nil {
		log.Fatal(err)
	}
	service.StartPromptSyncScheduler()
	service.StartCanvasProjectCleanupScheduler()
	handler.StartVideoTaskPoller()
	service.WakeComfyBridgePoller()
	address := ":" + config.Cfg.Port
	if config.Cfg.LocalToken != "" {
		address = "127.0.0.1:" + config.Cfg.Port
	}
	log.Fatal(router.New().Run(address))
}
