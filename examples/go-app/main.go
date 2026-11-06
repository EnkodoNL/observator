// SPDX-License-Identifier: FSL-1.1-ALv2

// Command server is the example app for testing the Observator snippet with Go: an HTTP server
// with one dependency, an old golang.org/x/net that has advisories on purpose.
package main

import (
	"fmt"
	"log"
	"net/http"

	"golang.org/x/net/html"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "Hello, %s\n", html.EscapeString(r.URL.Query().Get("name")))
	})
	log.Fatal(http.ListenAndServe(":8080", nil))
}
