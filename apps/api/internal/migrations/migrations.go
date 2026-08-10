// Package migrations holds the versioned SQL migrations (golang-migrate),
// embedded in the binary via go:embed — they work even in the distroless image,
// with no need to copy .sql files into the container.
//
// Naming convention: NNNNNN_description.up.sql / NNNNNN_description.down.sql.
// To add the next migration, create the matching .up.sql / .down.sql pair.
package migrations

import "embed"

// FS exposes this folder's .sql files to the runner (see config.RunMigrations).
//
//go:embed *.sql
var FS embed.FS
