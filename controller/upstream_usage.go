package controller

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/console_setting"

	"github.com/gin-gonic/gin"
)

// Upstream quota: how much of the upstream gateway's spending windows this
// deployment has used. The upstream gateway's usage page publishes it as JSON at
// console_setting.upstream_usage_url; only the fields below are passed on, so
// anything else the page adds never reaches the console.

type UpstreamUsageWindow struct {
	Window   string  `json:"window"`
	Percent  float64 `json:"percent"`
	ResetsAt *string `json:"resets_at"`
}

type UpstreamUsageGroup struct {
	Channel     string                `json:"channel"`
	Name        string                `json:"name"`
	Windows     []UpstreamUsageWindow `json:"windows"`
	LockedUntil string                `json:"locked_until,omitempty"`
	Error       string                `json:"error,omitempty"`
}

type UpstreamUsage struct {
	GeneratedAt string               `json:"generated_at"`
	Groups      []UpstreamUsageGroup `json:"groups"`
}

// Every signed-in user's overview polls this, so one fetch serves all of them for a while.
const upstreamUsageCacheTTL = 20 * time.Second

var upstreamUsageClient = &http.Client{Timeout: 10 * time.Second}

var upstreamUsageCache struct {
	sync.Mutex
	url       string
	fetchedAt time.Time
	usage     *UpstreamUsage
}

func fetchUpstreamUsage(ctx context.Context, url string) (*UpstreamUsage, error) {
	upstreamUsageCache.Lock()
	defer upstreamUsageCache.Unlock()
	if upstreamUsageCache.usage != nil && upstreamUsageCache.url == url &&
		time.Since(upstreamUsageCache.fetchedAt) < upstreamUsageCacheTTL {
		return upstreamUsageCache.usage, nil
	}

	var usage UpstreamUsage
	if err := getAndDecode(ctx, upstreamUsageClient, url, &usage); err != nil {
		return nil, err
	}
	if usage.Groups == nil {
		usage.Groups = []UpstreamUsageGroup{}
	}
	upstreamUsageCache.url = url
	upstreamUsageCache.fetchedAt = time.Now()
	upstreamUsageCache.usage = &usage
	return &usage, nil
}

// GetUpstreamUsage returns the upstream quota, or null data while the panel is off.
func GetUpstreamUsage(c *gin.Context) {
	cs := console_setting.GetConsoleSetting()
	if !cs.UpstreamUsageEnabled || cs.UpstreamUsageURL == "" {
		common.ApiSuccess(c, nil)
		return
	}
	usage, err := fetchUpstreamUsage(c.Request.Context(), cs.UpstreamUsageURL)
	if err != nil {
		common.SysError(common.LogText("failed to fetch upstream quota: %s", err.Error()))
		common.ApiErrorT(c, "Upstream quota is unavailable")
		return
	}
	common.ApiSuccess(c, usage)
}
