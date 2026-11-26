package model

// PoseRefView 参考图的一个视角。
type PoseRefView struct {
	Angle    string `json:"angle"`
	URL      string `json:"url"`
	CoverURL string `json:"coverUrl"`
	DepthURL string `json:"depthUrl,omitempty"`
}

// PoseRef 内置参考图库条目（姿势 / 服装 / 人像）。
type PoseRef struct {
	ID       string        `json:"id"`
	Kind     string        `json:"kind"`
	Group    string        `json:"group"`
	Category string        `json:"category"`
	Name     string        `json:"name"`
	Tags     []string      `json:"tags"`
	Prompt   string        `json:"prompt"`
	PromptEn string        `json:"promptEn"`
	Views    []PoseRefView `json:"views"`
	Width    int           `json:"width,omitempty"`
	Height   int           `json:"height,omitempty"`
	Search   string        `json:"-"`
}

// PoseRefQuery 参考图库筛选参数。
type PoseRefQuery struct {
	Query
	Kind  string
	Group string
	Angle string
}

// PoseRefList 参考图库分页结果。
type PoseRefList struct {
	Items      []PoseRef `json:"items"`
	Groups     []string  `json:"groups"`
	Categories []string  `json:"categories"`
	Angles     []string  `json:"angles"`
	Total      int       `json:"total"`
}
