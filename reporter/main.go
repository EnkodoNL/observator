// SPDX-License-Identifier: Apache-2.0

// Command observator-reporter reports the runtime versions and the lockfile of the image it
// runs in to Observator. It runs in a Dockerfile stage of its own (see the snippet), so neither
// the binary nor the key ends up in the final image.
//
// Like the plain sh snippet it never breaks a build: without a key it does nothing, and a
// report that fails is printed and skipped. Only the opt-in gate (OBSERVATOR_FAIL_ON) can fail
// the build.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// Set at build time: -ldflags "-X main.version=1.0.0".
var version = "dev"

type config struct {
	// Where package.json and the lockfile are: the stage's working directory.
	dir string
	// Written when the build may go on; the final stage copies it, which makes BuildKit run the
	// report stage at all.
	marker    string
	osRelease string
	timeout   time.Duration
}

var defaults = config{dir: ".", marker: "/tmp/.observator", osRelease: "/etc/os-release", timeout: 30 * time.Second}

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, defaults))
}

func run(args []string, getenv func(string) string, out io.Writer, cfg config) int {
	flags := flag.NewFlagSet("observator-reporter", flag.ContinueOnError)
	flags.SetOutput(out)
	keyless := flags.Bool("keyless", false, "report without OBSERVATOR_KEY too (servers on a shared key's IP allowlist)")
	showVersion := flags.Bool("version", false, "print the version and exit")
	if err := flags.Parse(args); err != nil {
		// A typo in the Dockerfile must not stop the build either.
		fmt.Fprintln(out, "Observator: report skipped, continuing")
		return done(out, cfg)
	}
	if *showVersion {
		fmt.Fprintln(out, "observator-reporter", version)
		return 0
	}

	key := strings.TrimSpace(getenv("OBSERVATOR_KEY"))
	if key == "" && !*keyless {
		// A build on a laptop stays local.
		return done(out, cfg)
	}
	url := strings.TrimRight(strings.TrimSpace(getenv("OBSERVATOR_URL")), "/")
	if url == "" {
		fmt.Fprintln(out, "Observator: OBSERVATOR_URL is not set, continuing")
		return done(out, cfg)
	}

	ctx, cancel := context.WithTimeout(context.Background(), cfg.timeout)
	defer cancel()
	body, err := archive(cfg.dir)
	if err != nil {
		fmt.Fprintf(out, "Observator: report failed, continuing (%v)\n", err)
		return done(out, cfg)
	}
	report := Report{
		Key:      key,
		Runtimes: formatRuntimes(detect(ctx, getenv("PATH"))),
		Platform: platform(),
		OS:       osID(cfg.osRelease),
		FailOn:   getenv("OBSERVATOR_FAIL_ON"),
		Project:  getenv("OBSERVATOR_PROJECT"),
		Labels:   getenv("OBSERVATOR_LABELS"),
		Domains:  getenv("OBSERVATOR_DOMAINS"),
		Body:     body,
	}
	answer, err := send(ctx, url+"/api/ingest", report)
	if answer != "" {
		fmt.Fprintln(out, strings.TrimRight(answer, "\n"))
	}
	if err != nil {
		fmt.Fprintf(out, "Observator: report failed, continuing (%v)\n", err)
		return done(out, cfg)
	}
	if gateFailed(answer) {
		return 1
	}
	return done(out, cfg)
}

// done writes the marker and lets the build go on.
func done(out io.Writer, cfg config) int {
	if err := os.WriteFile(cfg.marker, nil, 0o644); err != nil {
		fmt.Fprintf(out, "Observator: cannot write %s: %v\n", cfg.marker, err)
		return 1
	}
	return 0
}

// The server ends its answer with OBSERVATOR_GATE=fail (reason) when the gate is on and fails.
func gateFailed(answer string) bool {
	for _, line := range strings.Split(answer, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "OBSERVATOR_GATE=fail") {
			return true
		}
	}
	return false
}
