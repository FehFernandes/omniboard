package config

import (
	"time"

	"github.com/FehFernandes/omniboard/internal/storage"
)

// LoadR2 reads the configuration of the uploads bucket (Cloudflare R2 or any
// S3-compatible one).
//
// R2_ENDPOINT can be omitted when R2_ACCOUNT_ID is set — R2's S3 API endpoint
// is derivable from the account. Without configuration, uploads stay turned
// off and the app falls back to the old behavior (image embedded in the
// snapshot), instead of breaking.
func LoadR2() storage.Config {
	endpoint := getEnv("R2_ENDPOINT", "")
	if endpoint == "" {
		if acc := getEnv("R2_ACCOUNT_ID", ""); acc != "" {
			endpoint = "https://" + acc + ".r2.cloudflarestorage.com"
		}
	}
	return storage.Config{
		Endpoint:        endpoint,
		Bucket:          getEnv("R2_BUCKET", ""),
		AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
		SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		PublicBaseURL:   getEnv("R2_PUBLIC_BASE_URL", ""),
		Region:          getEnv("R2_REGION", "auto"),
		MaxBytes:        int64(envInt("R2_MAX_UPLOAD_BYTES", 10*1024*1024)),
		Expires:         time.Duration(envInt("R2_PRESIGN_EXPIRES_SECONDS", 300)) * time.Second,
	}
}
