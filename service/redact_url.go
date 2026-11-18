package service

import "net/url"

func RedactURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "[URL]"
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
