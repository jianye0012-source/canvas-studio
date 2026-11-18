package service

import "testing"

func TestRedactURL(t *testing.T) {
	cases := map[string]string{
		"https://u:p@h.com/v1/x?key=SECRET#f": "https://h.com/v1/x",
		"http://127.0.0.1:8080/a?token=1":     "http://127.0.0.1:8080/a",
		"://bad":                              "[URL]",
	}
	for input, want := range cases {
		if got := RedactURL(input); got != want {
			t.Fatalf("RedactURL(%q) = %q, want %q", input, got, want)
		}
	}
}
