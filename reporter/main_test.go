// SPDX-License-Identifier: Apache-2.0

package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseVersion(t *testing.T) {
	for in, want := range map[string]string{
		"v22.11.0\n":            "22.11.0",
		"1.2.3":                 "1.2.3",
		"3.12.4\nextra line":    "3.12.4",
		"vnext":                 "vnext",
		"8.4.1-dev+abc":         "8.4.1-dev+abc",
		"":                      "",
		"not a version at all":  "",
		strings.Repeat("9", 65): "",
	} {
		if got := parseVersion(in); got != want {
			t.Errorf("parseVersion(%q) = %q, want %q", in, got, want)
		}
	}
}

// A fake runtime on PATH: a script printing a version, as node -v would.
func fakeBin(t *testing.T, dir, name, output string) {
	t.Helper()
	script := "#!/bin/sh\nprintf '" + output + "'\n"
	if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestDetect(t *testing.T) {
	bin := t.TempDir()
	fakeBin(t, bin, "node", `v22.11.0\n`)
	fakeBin(t, bin, "python3", `3.12.4\n`)
	fakeBin(t, bin, "ruby", `garbage that is no version`)
	got := formatRuntimes(detect(t.Context(), bin))
	if got != "node/22.11.0,python/3.12.4" {
		t.Errorf("detect = %q", got)
	}
}

func TestOSID(t *testing.T) {
	file := filepath.Join(t.TempDir(), "os-release")
	os.WriteFile(file, []byte("NAME=\"Debian GNU/Linux\"\nID=\"debian\"\nVERSION_ID=13\n"), 0o644)
	if got := osID(file); got != "debian" {
		t.Errorf("osID = %q", got)
	}
	if got := osID(filepath.Join(t.TempDir(), "missing")); got != "" {
		t.Errorf("osID without file = %q", got)
	}
}

func TestArchive(t *testing.T) {
	dir := t.TempDir()
	if body, err := archive(dir); err != nil || body != nil {
		t.Fatalf("empty dir: %v %v", body, err)
	}
	os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"x"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "yarn.lock"), []byte("lock"), 0o644)
	os.WriteFile(filepath.Join(dir, "secret.env"), []byte("KEY=1"), 0o644)
	body, err := archive(dir)
	if err != nil {
		t.Fatal(err)
	}
	gz, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	var names []string
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, h.Name)
	}
	if strings.Join(names, ",") != "package.json,yarn.lock" {
		t.Errorf("archive has %v", names)
	}
}

func TestGateFailed(t *testing.T) {
	if !gateFailed("Observator: recorded build\nOBSERVATOR_GATE=fail (1 critical)") {
		t.Error("fail not seen")
	}
	if gateFailed("Observator: recorded build\nOBSERVATOR_GATE=pass") {
		t.Error("pass seen as fail")
	}
}

type server struct {
	*httptest.Server
	got  *http.Request
	body []byte
}

func newServer(t *testing.T, status int, answer string, delay time.Duration) *server {
	s := &server{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.got = r
		s.body, _ = io.ReadAll(r.Body)
		time.Sleep(delay)
		w.WriteHeader(status)
		io.WriteString(w, answer)
	}))
	t.Cleanup(s.Close)
	return s
}

func testConfig(t *testing.T) config {
	dir := t.TempDir()
	return config{dir: dir, marker: filepath.Join(dir, ".observator"), osRelease: filepath.Join(dir, "none"), timeout: 2 * time.Second}
}

func env(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func marked(cfg config) bool {
	_, err := os.Stat(cfg.marker)
	return err == nil
}

func TestRunSendsTheReport(t *testing.T) {
	s := newServer(t, 200, "Observator: recorded build for api (no runtime detected, linux/arm64, no lockfile)\n", 0)
	cfg := testConfig(t)
	var out bytes.Buffer
	code := run(nil, env(map[string]string{
		"OBSERVATOR_URL": s.URL + "/", "OBSERVATOR_KEY": "obs_secret", "OBSERVATOR_PROJECT": "api",
		"OBSERVATOR_LABELS": "env:prod", "OBSERVATOR_DOMAINS": "api.example.com", "OBSERVATOR_FAIL_ON": "high", "PATH": "",
	}), &out, cfg)
	if code != 0 || !marked(cfg) {
		t.Fatalf("code %d, marker %v, output %q", code, marked(cfg), out.String())
	}
	h := s.got.Header
	if s.got.URL.Path != "/api/ingest" || h.Get("Authorization") != "Bearer obs_secret" || h.Get("X-Project") != "api" ||
		h.Get("X-Labels") != "env:prod" || h.Get("X-Domains") != "api.example.com" || h.Get("X-Fail-On") != "high" || !strings.HasPrefix(h.Get("X-Reporter"), "observator-reporter/") {
		t.Errorf("request %s %v", s.got.URL.Path, h)
	}
	// Sent even when empty: no runtime found.
	if _, ok := h["X-Runtime"]; !ok {
		t.Error("X-Runtime missing")
	}
	if len(s.body) != 0 {
		t.Errorf("body without manifests: %d bytes", len(s.body))
	}
	if !strings.Contains(out.String(), "recorded build for api") || strings.Contains(out.String(), "obs_secret") {
		t.Errorf("output %q", out.String())
	}
}

func TestRunWithoutKeyStaysLocal(t *testing.T) {
	s := newServer(t, 200, "", 0)
	cfg := testConfig(t)
	var out bytes.Buffer
	if code := run(nil, env(map[string]string{"OBSERVATOR_URL": s.URL}), &out, cfg); code != 0 || !marked(cfg) {
		t.Fatal("no key must pass")
	}
	if s.got != nil || out.Len() != 0 {
		t.Errorf("reported without a key: %q", out.String())
	}
	// --keyless reports anyway, for allowlisted servers.
	run([]string{"--keyless"}, env(map[string]string{"OBSERVATOR_URL": s.URL}), &out, testConfig(t))
	if s.got == nil || s.got.Header.Get("Authorization") != "" {
		t.Error("--keyless did not report")
	}
}

func TestRunNeverBreaksTheBuild(t *testing.T) {
	cases := map[string]string{"refused": "", "unreachable": "http://127.0.0.1:9", "slow": ""}
	for name, url := range cases {
		t.Run(name, func(t *testing.T) {
			if url == "" {
				delay := time.Duration(0)
				if name == "slow" {
					delay = 3 * time.Second
				}
				url = newServer(t, 401, "Observator: not recorded: unknown key", delay).URL
			}
			cfg := testConfig(t)
			var out bytes.Buffer
			code := run(nil, env(map[string]string{"OBSERVATOR_URL": url, "OBSERVATOR_KEY": "obs_x"}), &out, cfg)
			if code != 0 || !marked(cfg) || !strings.Contains(out.String(), "report failed, continuing") {
				t.Errorf("code %d marker %v output %q", code, marked(cfg), out.String())
			}
		})
	}
}

func TestRunGateFails(t *testing.T) {
	s := newServer(t, 200, "Observator: recorded build\nOBSERVATOR_GATE=fail (1 critical)\n", 0)
	cfg := testConfig(t)
	var out bytes.Buffer
	if code := run(nil, env(map[string]string{"OBSERVATOR_URL": s.URL, "OBSERVATOR_KEY": "obs_x"}), &out, cfg); code != 1 || marked(cfg) {
		t.Errorf("gate: code %d marker %v", code, marked(cfg))
	}
}
