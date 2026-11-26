package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

var (
	poseRefs     []model.PoseRef
	poseRefsOnce sync.Once
	poseRefsErr  error
)

// 性感系、双人缠绵姿势不导入。
var poseExcludedGroups = []string{"全身单人・性感系", "双人缠绵"}

type poseGalleryRecord struct {
	ID       string   `json:"id"`
	System   string   `json:"体系"`
	PoseNo   string   `json:"姿势编号"`
	Category string   `json:"分类"`
	PoseName string   `json:"姿势名称"`
	Angle    string   `json:"角度"`
	Name     string   `json:"服装名称"`
	Tags     []string `json:"标签"`
	Keywords string   `json:"关键词"`
	Section  string   `json:"分区"`
	HairLen  string   `json:"发长"`
	Hair     string   `json:"发型名称"`
	Title    string   `json:"标题"`
	Width    int      `json:"宽"`
	Height   int      `json:"高"`
	Hot      bool     `json:"热门"`
	Featured bool     `json:"精选"`
	Thumb    string   `json:"缩略图"`
	Image    string   `json:"原图"`
	Search   string   `json:"检索"`
	Views    []struct {
		Label string `json:"label"`
		Thumb string `json:"缩略图"`
		Image string `json:"原图"`
	} `json:"views"`
}

// ListPoseRefs 按条件返回内置参考图库条目。
func ListPoseRefs(q model.PoseRefQuery) (model.PoseRefList, error) {
	poseRefsOnce.Do(func() { poseRefs, poseRefsErr = loadPoseRefs() })
	if poseRefsErr != nil {
		return model.PoseRefList{}, poseRefsErr
	}
	q.Normalize()
	result := model.PoseRefList{Items: []model.PoseRef{}, Groups: []string{}, Categories: []string{}, Angles: []string{}}
	matched := []model.PoseRef{}
	for _, item := range poseRefs {
		if item.Kind != q.Kind {
			continue
		}
		result.Groups = appendUnique(result.Groups, item.Group)
		if q.Group != "" && item.Group != q.Group {
			continue
		}
		result.Categories = appendUnique(result.Categories, item.Category)
		for _, view := range item.Views {
			result.Angles = appendUnique(result.Angles, view.Angle)
		}
		if q.Category != "" && item.Category != q.Category {
			continue
		}
		if q.Keyword != "" && !strings.Contains(item.Search, strings.ToLower(q.Keyword)) {
			continue
		}
		if q.Angle != "" {
			index := slices.IndexFunc(item.Views, func(view model.PoseRefView) bool { return view.Angle == q.Angle })
			if index < 0 {
				continue
			}
			views := append([]model.PoseRefView{item.Views[index]}, slices.Delete(slices.Clone(item.Views), index, index+1)...)
			item.Views = views
		}
		matched = append(matched, item)
	}
	result.Total = len(matched)
	start := min(q.Offset(), len(matched))
	result.Items = append(result.Items, matched[start:min(start+q.PageSize, len(matched))]...)
	return result, nil
}

// PoseGalleryFilePath 返回图库内 img/thumbs 下的安全文件路径。
func PoseGalleryFilePath(name string) (string, bool) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(name, "/")))
	first := strings.Split(filepath.ToSlash(clean), "/")[0]
	base := filepath.Base(clean)
	if !filepath.IsLocal(clean) || (first != "img" && first != "thumbs") || strings.HasPrefix(base, "full_sexy_") || strings.HasPrefix(base, "pair60_") {
		return "", false
	}
	return filepath.Join(config.Cfg.PoseGalleryDir, clean), true
}

func loadPoseRefs() ([]model.PoseRef, error) {
	read := func(name string) ([]poseGalleryRecord, error) {
		data, err := os.ReadFile(filepath.Join(config.Cfg.PoseGalleryDir, "data", name))
		if err != nil {
			return nil, fmt.Errorf("读取参考图库 %s: %w", name, err)
		}
		var records []poseGalleryRecord
		return records, json.Unmarshal(data, &records)
	}
	poses, err := read("pose-zh.json")
	if err != nil {
		return nil, err
	}
	costumes, err := read("costume-zh.json")
	if err != nil {
		return nil, err
	}
	shisei, err := read("costume-shisei-zh.json")
	if err != nil {
		return nil, err
	}
	portraits, err := read("portrait-zh.json")
	if err != nil {
		return nil, err
	}

	items := []model.PoseRef{}
	index := map[string]int{}
	for _, r := range poses {
		if slices.Contains(poseExcludedGroups, r.System) {
			continue
		}
		key := r.System + r.PoseNo
		view := model.PoseRefView{Angle: r.Angle, URL: r.Image, CoverURL: r.Thumb, DepthURL: poseDepthPath(r.Image)}
		if i, ok := index[key]; ok {
			items[i].Views = append(items[i].Views, view)
			continue
		}
		index[key] = len(items)
		items = append(items, model.PoseRef{
			ID: r.ID[:max(strings.LastIndex(r.ID, "_"), 0)], Kind: "pose", Group: r.System, Category: r.Category, Name: r.PoseName,
			Prompt:   fmt.Sprintf("动作：%s（%s·%s）", r.PoseName, r.System, r.Category),
			PromptEn: fmt.Sprintf("pose: %s (%s)", r.PoseName, r.Category),
			Views:    []model.PoseRefView{view},
			Search:   strings.ToLower(r.Search + r.PoseNo),
		})
	}
	for _, r := range costumes {
		items = append(items, costumeRef(r, "日常穿搭", []model.PoseRefView{{Angle: "正面", URL: r.Image, CoverURL: r.Thumb}}))
	}
	for _, r := range shisei {
		views := []model.PoseRefView{}
		for _, v := range r.Views {
			views = append(views, model.PoseRefView{Angle: v.Label, URL: v.Image, CoverURL: v.Thumb})
		}
		items = append(items, costumeRef(r, "中国历代", views))
	}
	for _, r := range portraits {
		tags := []string{r.Hair}
		if r.Hot {
			tags = append(tags, "热门")
		}
		if r.Featured {
			tags = append(tags, "精选")
		}
		items = append(items, model.PoseRef{
			ID: r.ID, Kind: "portrait", Group: r.Section, Category: r.HairLen, Name: r.Title, Tags: tags,
			Prompt:   fmt.Sprintf("人物面部与发型：%s、%s（%s，%s）", r.HairLen, r.Hair, r.Section, r.Title),
			PromptEn: fmt.Sprintf("character hairstyle and face reference: %s, %s", r.HairLen, r.Hair),
			Views:    []model.PoseRefView{{Angle: "正面", URL: r.Image, CoverURL: r.Thumb}},
			Width:    r.Width, Height: r.Height,
			Search: strings.ToLower(r.Search + r.Title + r.Hair),
		})
	}
	return items, nil
}

func costumeRef(r poseGalleryRecord, group string, views []model.PoseRefView) model.PoseRef {
	prompt := fmt.Sprintf("身穿%s：%s", r.Category, r.Name)
	if len(r.Tags) > 0 {
		prompt += fmt.Sprintf("（细节：%s）", strings.Join(r.Tags[:min(len(r.Tags), 8)], "、"))
	}
	return model.PoseRef{
		ID: r.ID, Kind: "costume", Group: group, Category: r.Category, Name: r.Name, Tags: r.Tags,
		Prompt: prompt, PromptEn: r.Keywords, Views: views,
		Search: strings.ToLower(r.Name + strings.Join(r.Tags, " ") + r.Keywords + r.ID),
	}
}

func poseDepthPath(image string) string {
	if !strings.HasPrefix(image, "img/") {
		return ""
	}
	return "img/depth/" + strings.TrimSuffix(strings.TrimPrefix(image, "img/"), filepath.Ext(image)) + ".webp"
}

func appendUnique(items []string, value string) []string {
	if value == "" || slices.Contains(items, value) {
		return items
	}
	return append(items, value)
}
