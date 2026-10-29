// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Report is what goes to POST /api/ingest: the same headers as the sh snippet sends.
type Report struct {
	Key      string
	Runtimes string
	Platform string
	OS       string
	FailOn   string
	Project  string
	Labels   string
	Domains  string
	Body     []byte
}

// The answer is a few lines of text for the build log.
const maxAnswer = 64 << 10

// send posts the report and returns the server's answer. A non-2xx status is an error, with the
// answer still returned so the build log shows why.
func send(ctx context.Context, url string, r Report) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(r.Body))
	if err != nil {
		return "", err
	}
	agent := "observator-reporter/" + version
	for name, value := range map[string]string{
		"X-Runtime":    r.Runtimes,
		"X-Platform":   r.Platform,
		"X-Os":         r.OS,
		"X-Fail-On":    r.FailOn,
		"X-Project":    r.Project,
		"X-Labels":     r.Labels,
		"X-Domains":    r.Domains,
		"X-Reporter":   agent,
		"User-Agent":   agent,
		"Content-Type": "application/gzip",
	} {
		req.Header.Set(name, value)
	}
	// Without a key (--keyless) there is no Authorization at all: the server goes by address.
	if r.Key != "" {
		req.Header.Set("Authorization", "Bearer "+r.Key)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(res.Body, maxAnswer))
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(string(answer))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return text, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return text, nil
}
