// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Runtime is one entry of X-Runtime: node/22.11.0.
type Runtime struct {
	Name    string
	Version string
}

// The same commands as the sh snippet (app/src/lib/snippet.ts), each printing only a version.
// Paths are where images keep a runtime off PATH: distroless has node in /nodejs/bin.
var probes = []struct {
	name  string
	cmd   []string
	paths []string
}{
	{"node", []string{"node", "-v"}, []string{"/nodejs/bin/node"}},
	{"bun", []string{"bun", "--version"}, nil},
	{"deno", []string{"deno", "eval", "console.log(Deno.version.deno)"}, nil},
	{"python", []string{"python3", "-c", "import platform;print(platform.python_version())"}, nil},
	{"php", []string{"php", "-r", "echo PHP_VERSION;"}, nil},
	{"ruby", []string{"ruby", "-e", "print RUBY_VERSION"}, nil},
}

// As the server accepts them.
var versionPattern = regexp.MustCompile(`^[0-9A-Za-z.+_-]{1,64}$`)

const probeTimeout = 5 * time.Second

// detect runs each probe that has a binary, without a shell: the image may not have one.
func detect(ctx context.Context, path string) []Runtime {
	var found []Runtime
	for _, p := range probes {
		bin := lookPath(p.cmd[0], path, p.paths)
		if bin == "" {
			continue
		}
		pctx, cancel := context.WithTimeout(ctx, probeTimeout)
		cmd := exec.CommandContext(pctx, bin, p.cmd[1:]...)
		cmd.Stderr = nil
		output, err := cmd.Output()
		cancel()
		if err != nil {
			continue
		}
		if v := parseVersion(string(output)); v != "" {
			found = append(found, Runtime{p.name, v})
		}
	}
	return found
}

func lookPath(name, path string, extra []string) string {
	for _, dir := range filepath.SplitList(path) {
		if dir == "" {
			continue
		}
		if candidate := filepath.Join(dir, name); executable(candidate) {
			return candidate
		}
	}
	for _, candidate := range extra {
		if executable(candidate) {
			return candidate
		}
	}
	return ""
}

func executable(file string) bool {
	info, err := os.Stat(file)
	return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
}

// parseVersion takes the first line of a probe's output: "v22.11.0\n" becomes 22.11.0.
func parseVersion(output string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(output), "\n")
	v := strings.TrimSpace(line)
	if len(v) > 1 && v[0] == 'v' && v[1] >= '0' && v[1] <= '9' {
		v = v[1:]
	}
	if !versionPattern.MatchString(v) {
		return ""
	}
	return v
}

// "node/22.11.0,python/3.12.4"
func formatRuntimes(runtimes []Runtime) string {
	parts := make([]string, len(runtimes))
	for i, r := range runtimes {
		parts[i] = r.Name + "/" + r.Version
	}
	return strings.Join(parts, ",")
}

// The binary is built per platform, so its own architecture is the image's.
func platform() string {
	return runtime.GOOS + "/" + runtime.GOARCH
}

// osID is ID from os-release ("alpine", "debian"), or "" without one (scratch).
func osID(file string) string {
	f, err := os.Open(file)
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if value, ok := strings.CutPrefix(strings.TrimSpace(scanner.Text()), "ID="); ok {
			return strings.Trim(value, `"'`)
		}
	}
	return ""
}
