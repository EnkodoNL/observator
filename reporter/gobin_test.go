// SPDX-License-Identifier: Apache-2.0

package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// copyTestBinary puts this test's own binary, a real Go program, in dir under name.
func copyTestBinary(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := os.ReadFile(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestScanGoReadsTheBinary(t *testing.T) {
	dir := t.TempDir()
	app := copyTestBinary(t, dir, "server")
	// Not programs: a script with the executable bit, and a binary without it.
	os.WriteFile(filepath.Join(dir, "start.sh"), []byte("#!/bin/sh\n"), 0o755)
	copyTestBinary(t, dir, "plain")
	os.Chmod(filepath.Join(dir, "plain"), 0o644)
	// The same file twice: the working directory is also one of the scanned folders.
	found := scanGo(context.Background(), []string{dir, dir})
	if len(found) != 1 {
		t.Fatalf("found %d binaries: %+v", len(found), found)
	}
	b := found[0]
	if b.Path != app || b.Go != goVersion(runtime.Version()) || b.Main != "github.com/EnkodoNL/observator/reporter" {
		t.Errorf("binary %s go %s main %s", b.Path, b.Go, b.Main)
	}
	var fallback bool
	for _, m := range b.Modules {
		fallback = fallback || (m.Path == "golang.org/x/crypto/x509roots/fallback" && strings.HasPrefix(m.Version, "v"))
	}
	if !fallback {
		t.Errorf("modules %v", b.Modules)
	}
}

func TestScanGoSkipsItself(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if found := scanGo(context.Background(), []string{filepath.Dir(self)}); len(found) != 0 {
		t.Errorf("found itself: %+v", found)
	}
}

func TestGoVersion(t *testing.T) {
	for in, want := range map[string]string{
		"go1.26.2":                      "1.26.2",
		"go1.27.3 X:nocoverageredesign": "1.27.3",
		"go1.20":                        "1.20",
		"go1.28rc1":                     "1.28rc1",
		"devel go1.28-abcdef Mon Jan 1": "",
		"":                              "",
	} {
		if got := goVersion(in); got != want {
			t.Errorf("goVersion(%q) = %q, want %q", in, got, want)
		}
	}
	if got := oldestGo([]GoBinary{{Go: "1.27.3"}, {Go: "1.26.10"}, {Go: "1.27rc1"}}); got != "1.26.10" {
		t.Errorf("oldestGo = %q", got)
	}
}

func TestRunSendsGo(t *testing.T) {
	s := newServer(t, 200, "Observator: recorded build\n", 0)
	cfg := testConfig(t)
	cfg.goDirs = []string{t.TempDir()}
	copyTestBinary(t, cfg.goDirs[0], "server")
	var out bytes.Buffer
	if code := run(nil, env(map[string]string{"OBSERVATOR_URL": s.URL, "OBSERVATOR_KEY": "obs_k"}), &out, cfg); code != 0 {
		t.Fatalf("code %d, output %q", code, out.String())
	}
	if want := "go/" + goVersion(runtime.Version()); s.got.Header.Get("X-Runtime") != want {
		t.Errorf("X-Runtime %q, want %q", s.got.Header.Get("X-Runtime"), want)
	}
	gz, err := gzip.NewReader(bytes.NewReader(s.body))
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	h, err := tr.Next()
	if err != nil || h.Name != goBinariesFile {
		t.Fatalf("first entry %v %v", h, err)
	}
	var file struct{ Binaries []GoBinary }
	data, _ := io.ReadAll(tr)
	if err := json.Unmarshal(data, &file); err != nil || len(file.Binaries) != 1 || len(file.Binaries[0].Modules) == 0 {
		t.Errorf("go-binaries.json %s (%v)", data, err)
	}
}
