package controller

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The upstream gateway's page as it publishes it, including fields the console must not pass on.
const upstreamUsagePage = `{"person":"WeijingWenhua","generated_at":"2026-11-05T18:00:08+00:00","groups":[
{"channel":"Gemini","name":"Gemini","used":18,"limit":180,"windows":[
{"window":"5h","percent":10,"resets_at":"2026-11-05T22:54:06+00:00","used":18,"limit":180},
{"window":"7d","percent":25.5,"resets_at":null}],"locked_until":"2026-11-09T00:00:00+00:00"},
{"channel":"Claude","error":"unavailable"}]}`

type upstreamUsageResponse struct {
	Success bool           `json:"success"`
	Message string         `json:"message"`
	Data    map[string]any `json:"data"`
}

func setUpstreamUsage(t *testing.T, enabled bool, url string) {
	t.Helper()
	cs := console_setting.GetConsoleSetting()
	originalEnabled, originalURL := cs.UpstreamUsageEnabled, cs.UpstreamUsageURL
	cs.UpstreamUsageEnabled, cs.UpstreamUsageURL = enabled, url
	upstreamUsageCache.usage = nil
	t.Cleanup(func() {
		cs.UpstreamUsageEnabled, cs.UpstreamUsageURL = originalEnabled, originalURL
		upstreamUsageCache.usage = nil
	})
}

func requestUpstreamUsage(t *testing.T) upstreamUsageResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/upstream_usage", nil)
	GetUpstreamUsage(context)
	var response upstreamUsageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func newUpstreamUsageServer(t *testing.T, status int, body string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	hits := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server, hits
}

func TestGetUpstreamUsageWhilePanelIsOffReturnsNoDataWithoutFetching(t *testing.T) {
	server, hits := newUpstreamUsageServer(t, http.StatusOK, upstreamUsagePage)
	setUpstreamUsage(t, false, server.URL)

	response := requestUpstreamUsage(t)

	assert.True(t, response.Success)
	assert.Nil(t, response.Data)
	assert.Zero(t, hits.Load())
}

func TestGetUpstreamUsagePassesOnOnlyWindowsResetsAndLocks(t *testing.T) {
	server, hits := newUpstreamUsageServer(t, http.StatusOK, upstreamUsagePage)
	setUpstreamUsage(t, true, server.URL)

	response := requestUpstreamUsage(t)
	require.True(t, response.Success)
	encoded, err := common.Marshal(response.Data)
	require.NoError(t, err)

	assert.JSONEq(t, `{"generated_at":"2026-11-05T18:00:08+00:00","groups":[
{"channel":"Gemini","name":"Gemini","windows":[
{"window":"5h","percent":10,"resets_at":"2026-11-05T22:54:06+00:00"},
{"window":"7d","percent":25.5,"resets_at":null}],"locked_until":"2026-11-09T00:00:00+00:00"},
{"channel":"Claude","name":"","windows":null,"error":"unavailable"}]}`, string(encoded))
	assert.Equal(t, int32(1), hits.Load())
}

func TestGetUpstreamUsageServesRepeatedRequestsFromOneFetch(t *testing.T) {
	server, hits := newUpstreamUsageServer(t, http.StatusOK, upstreamUsagePage)
	setUpstreamUsage(t, true, server.URL)

	requestUpstreamUsage(t)
	requestUpstreamUsage(t)
	assert.Equal(t, int32(1), hits.Load())

	upstreamUsageCache.fetchedAt = time.Now().Add(-upstreamUsageCacheTTL)
	requestUpstreamUsage(t)
	assert.Equal(t, int32(2), hits.Load())
}

func TestGetUpstreamUsageReportsAnUnreachableUpstreamAsUnavailable(t *testing.T) {
	server, _ := newUpstreamUsageServer(t, http.StatusBadGateway, `{}`)
	setUpstreamUsage(t, true, server.URL)

	response := requestUpstreamUsage(t)

	assert.False(t, response.Success)
	assert.Equal(t, "Upstream quota is unavailable", response.Message)
}

func TestGetStatusShowsUpstreamUsageOnlyWhenEnabledWithURL(t *testing.T) {
	originalOptionMap := common.OptionMap
	t.Cleanup(func() { common.OptionMap = originalOptionMap })
	common.OptionMap = map[string]string{}

	for _, tt := range []struct {
		enabled bool
		url     string
		want    bool
	}{
		{enabled: true, url: "http://gateway:4000/usage/a/data", want: true},
		{enabled: true, url: "", want: false},
		{enabled: false, url: "http://gateway:4000/usage/a/data", want: false},
	} {
		setUpstreamUsage(t, tt.enabled, tt.url)
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
		GetStatus(context)
		var response upstreamUsageResponse
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		assert.Equal(t, tt.want, response.Data["upstream_usage_enabled"], tt)
	}
}

func TestUpstreamUsageURLValidation(t *testing.T) {
	for _, tt := range []struct {
		url   string
		valid bool
	}{
		{url: "http://100.106.223.0:4000/usage/微晶文化/data", valid: true},
		{url: "https://gateway.example/usage/a/data", valid: true},
		{url: "", valid: true},
		{url: "ftp://gateway.example/data", valid: false},
		{url: "gateway.example/usage", valid: false},
		{url: "http://user:secret@gateway.example/data", valid: false},
		{url: "http:///data", valid: false},
	} {
		err := console_setting.ValidateConsoleSettings(tt.url, "UpstreamUsageURL")
		assert.Equal(t, tt.valid, err == nil, tt.url)
	}
}
