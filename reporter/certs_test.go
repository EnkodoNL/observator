// SPDX-License-Identifier: Apache-2.0

package main

import (
	"crypto/x509"
	"os"
	"os/exec"
	"runtime"
	"testing"
)

// Without a CA bundle in the image, the fallback roots still verify HTTPS. Runs in a child
// process, because Go loads the system roots once per process.
func TestFallbackRoots(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("macOS and Windows verify through the OS, not through a CA bundle")
	}
	if os.Getenv("OBSERVATOR_ROOTS_CHILD") == "1" {
		pool, err := x509.SystemCertPool()
		if err != nil {
			t.Fatal(err)
		}
		if pool.Equal(x509.NewCertPool()) {
			t.Fatal("no roots without a CA bundle")
		}
		return
	}
	empty := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestFallbackRoots$")
	cmd.Env = append(os.Environ(), "OBSERVATOR_ROOTS_CHILD=1", "SSL_CERT_FILE="+empty+"/none", "SSL_CERT_DIR="+empty)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
}
