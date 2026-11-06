// SPDX-License-Identifier: Apache-2.0

package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// The files the server reads; nothing else leaves the image.
var manifests = []string{"package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"}

// The Go programs found in the image (see gobin.go), written by the reporter itself.
const goBinariesFile = "go-binaries.json"

// archive packs the manifests found in dir, and goBinaries when given, as tar.gz. Without any
// it returns an empty body: an image with runtimes but no package manager to read.
func archive(dir string, goBinaries []byte) ([]byte, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	found := 0
	add := func(name string, data []byte) error {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(data)), Typeflag: tar.TypeReg}); err != nil {
			return err
		}
		_, err := tw.Write(data)
		found++
		return err
	}
	for _, name := range manifests {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if err := add(name, data); err != nil {
			return nil, err
		}
	}
	if goBinaries != nil {
		if err := add(goBinariesFile, goBinaries); err != nil {
			return nil, err
		}
	}
	if found == 0 {
		return nil, nil
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
