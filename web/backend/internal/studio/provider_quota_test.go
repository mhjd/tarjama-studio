package studio

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestProviderRateLimitDoesNotExposeResponse(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		daily      bool
	}{
		{"daily", `{"error":{"message":"sensitive credential or project identifier","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}`, false},
		{"minute", `{"error":{"message":"sensitive","details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}`, false},
		{"malformed", `sensitive upstream HTML`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": []string{"60"}}, Body: io.NopCloser(strings.NewReader(tc.body))}
			defer response.Body.Close()
			err := providerError(response)
			if !err.Temporary || err.After != time.Minute || strings.Contains(err.Public, "sensitive") {
				t.Fatalf("Incorrect safe quota handling: %v", err)
			}
			if strings.Contains(err.Public, "quota quotidien") != tc.daily {
				t.Fatalf("Daily versus transient limit misclassified: %v", err)
			}
		})
	}
}
