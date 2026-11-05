package console_setting

import "github.com/QuantumNous/new-api/setting/config"

type ConsoleSetting struct {
	ApiInfo              string `json:"api_info"`               // 控制台 API 信息 (JSON 数组字符串)
	UptimeKumaGroups     string `json:"uptime_kuma_groups"`     // Uptime Kuma 分组配置 (JSON 数组字符串)
	Announcements        string `json:"announcements"`          // 系统公告 (JSON 数组字符串)
	FAQ                  string `json:"faq"`                    // 常见问题 (JSON 数组字符串)
	UpstreamUsageURL     string `json:"upstream_usage_url"`     // 上游额度数据地址 (上游网关用量页的 /data)
	ApiInfoEnabled       bool   `json:"api_info_enabled"`       // 是否启用 API 信息面板
	UptimeKumaEnabled    bool   `json:"uptime_kuma_enabled"`    // 是否启用 Uptime Kuma 面板
	AnnouncementsEnabled bool   `json:"announcements_enabled"`  // 是否启用系统公告面板
	FAQEnabled           bool   `json:"faq_enabled"`            // 是否启用常见问答面板
	UpstreamUsageEnabled bool   `json:"upstream_usage_enabled"` // 是否启用上游额度面板
}

// 默认配置
var defaultConsoleSetting = ConsoleSetting{
	ApiInfo:              "",
	UptimeKumaGroups:     "",
	Announcements:        "",
	FAQ:                  "",
	UpstreamUsageURL:     "",
	ApiInfoEnabled:       true,
	UptimeKumaEnabled:    true,
	AnnouncementsEnabled: true,
	FAQEnabled:           true,
	UpstreamUsageEnabled: false,
}

// 全局实例
var consoleSetting = defaultConsoleSetting

func init() {
	// 注册到全局配置管理器，键名为 console_setting
	config.GlobalConfig.Register("console_setting", &consoleSetting)
}

// GetConsoleSetting 获取 ConsoleSetting 配置实例
func GetConsoleSetting() *ConsoleSetting {
	return &consoleSetting
}
