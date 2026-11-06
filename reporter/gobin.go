// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"debug/buildinfo"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// GoBinary is one Go program in the image, as go-binaries.json carries it. A Go binary keeps its
// Go version and every linked module, also when built with -trimpath -s -w, and debug/buildinfo
// reads that without a toolchain or a shell.
type GoBinary struct {
	Path    string     `json:"path"`
	Go      string     `json:"go"`
	Main    string     `json:"main"`
	Version string     `json:"version,omitempty"`
	Modules []GoModule `json:"modules"`
}

type GoModule struct {
	Path    string `json:"path"`
	Version string `json:"version"`
}

// Where images put the program: the top of these folders, not below. PATH and /usr/bin are left
// out on purpose: base images keep helpers there that are not the app.
var goDirs = []string{"/", "/app", "/srv", "/ko-app", "/usr/local/bin"}

// Go programs that are tooling, not the app: the toolchain (cmd/go, cmd/compile...) and gosu,
// which many base images carry.
var notTheApp = []string{"cmd/", "github.com/tianon/gosu"}

const (
	maxGoFiles    = 3000
	maxGoBinaries = 20
	maxGoModules  = 5000
)

// scanGo finds the Go programs at the top of dirs, skipping the reporter itself.
func scanGo(ctx context.Context, dirs []string) []GoBinary {
	var self os.FileInfo
	if path, err := os.Executable(); err == nil {
		self, _ = os.Stat(path)
	}
	var seen []os.FileInfo
	var found []GoBinary
	modules := 0
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if ctx.Err() != nil || len(seen) >= maxGoFiles || len(found) >= maxGoBinaries {
				return found
			}
			path := filepath.Join(dir, entry.Name())
			info, err := os.Stat(path)
			if err != nil || !info.Mode().IsRegular() || info.Mode()&0o111 == 0 {
				continue
			}
			// The same file twice: a symlink, or the working directory being one of dirs.
			if (self != nil && os.SameFile(info, self)) || seenBefore(seen, info) {
				continue
			}
			seen = append(seen, info)
			bi, err := buildinfo.ReadFile(path)
			if err != nil {
				continue
			}
			if b, ok := goBinary(path, bi, maxGoModules-modules); ok {
				modules += len(b.Modules)
				found = append(found, b)
			}
		}
	}
	return found
}

func seenBefore(seen []os.FileInfo, info os.FileInfo) bool {
	for _, s := range seen {
		if os.SameFile(s, info) {
			return true
		}
	}
	return false
}

func goBinary(path string, bi *buildinfo.BuildInfo, room int) (GoBinary, bool) {
	v := goVersion(bi.GoVersion)
	main := bi.Main.Path
	if main == "" {
		main = bi.Path
	}
	if v == "" {
		return GoBinary{}, false
	}
	for _, prefix := range notTheApp {
		if strings.HasPrefix(main, prefix) {
			return GoBinary{}, false
		}
	}
	b := GoBinary{Path: path, Go: v, Main: main, Modules: []GoModule{}}
	if bi.Main.Version != "(devel)" {
		b.Version = bi.Main.Version
	}
	for _, dep := range bi.Deps {
		if len(b.Modules) >= room {
			break
		}
		m := dep
		if dep.Replace != nil {
			// A replace by a local path has no version to check.
			if dep.Replace.Version == "" {
				continue
			}
			m = dep.Replace
		}
		b.Modules = append(b.Modules, GoModule{Path: m.Path, Version: m.Version})
	}
	return b, true
}

// goVersion turns "go1.26.2 X:nocoverageredesign" into 1.26.2; a development build gives "".
func goVersion(s string) string {
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return ""
	}
	v := strings.TrimPrefix(fields[0], "go")
	if v == "" || v[0] < '0' || v[0] > '9' || strings.Contains(v, "devel") || !versionPattern.MatchString(v) {
		return ""
	}
	return v
}

// oldestGo is the Go version to report when the image has several programs: the oldest is the
// one that needs a fix first.
func oldestGo(binaries []GoBinary) string {
	oldest := ""
	for _, b := range binaries {
		if oldest == "" || goLess(b.Go, oldest) {
			oldest = b.Go
		}
	}
	return oldest
}

// goLess compares 1.26.2 with 1.27 number by number; a pre-release suffix (1.27rc1) counts as 0.
func goLess(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < max(len(pa), len(pb)); i++ {
		na, nb := goPart(pa, i), goPart(pb, i)
		if na != nb {
			return na < nb
		}
	}
	return false
}

func goPart(parts []string, i int) int {
	if i >= len(parts) {
		return 0
	}
	digits := parts[i]
	if end := strings.IndexFunc(digits, func(r rune) bool { return r < '0' || r > '9' }); end >= 0 {
		digits = digits[:end]
	}
	n, _ := strconv.Atoi(digits)
	return n
}

// goFile is go-binaries.json, or nil when the image has no Go program.
func goFile(binaries []GoBinary) []byte {
	if len(binaries) == 0 {
		return nil
	}
	data, err := json.Marshal(map[string][]GoBinary{"binaries": binaries})
	if err != nil {
		return nil
	}
	return data
}
