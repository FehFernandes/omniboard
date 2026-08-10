package jobs

import (
	"context"
	"encoding/json"
	"log/slog"
	"regexp"
	"time"

	"gorm.io/gorm"

	"github.com/cachyosso/omniboard/internal/models"
	"github.com/cachyosso/omniboard/internal/storage"
)

// Sweep of orphan images in the bucket.
//
// An image removed from the board (or replaced) keeps taking up space: the
// client has no credential to delete it, and the server did not know it
// existed. Without this the bucket only grows.
//
// The rule is conservative on purpose, because the cost of being wrong is
// asymmetric — wasted space is cheap, deleting a live image is lost work:
//
//  1. We only look at the user's own prefix (u/<id>/).
//  2. We only delete what does NOT appear in their workspace.
//  3. We only delete an object older than the grace period (default 48h). A
//     freshly uploaded image may not be in a confirmed save yet.
//  4. A failure on one user does not interrupt the others.

// OrphanGrace is the minimum age for an unreferenced object to be removed.
const OrphanGrace = 48 * time.Hour

// urlNoJSON finds http(s) URLs inside the workspace JSON. We work with the raw
// text on purpose: the snapshot can have an image at any level (element, board,
// future version), and a structural parser would have to track the client's
// format to avoid losing a reference — being wrong here deletes a live image.
var urlNoJSON = regexp.MustCompile(`https?://[^"\\\s]+`)

// StartOrphanSweep runs the sweep periodically. Returns the stop function.
//
// With no bucket configured it does nothing (and does not log every cycle): the
// service runs perfectly without storage, with the image embedded in the snapshot.
func StartOrphanSweep(db *gorm.DB, cl *storage.Client, interval time.Duration) (stop func()) {
	if cl == nil || !cl.Config().Enabled() {
		slog.Info("orphan sweep disabled (bucket not configured)")
		return func() {}
	}
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		// Does not run at boot: a deploy is the worst moment for a sweep.
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if r, err := SweepOrphans(ctx, db, cl, OrphanGrace); err != nil {
					slog.Warn("orphan sweep failed", "err", err)
				} else {
					slog.Info("orphan sweep finished",
						"users", r.Users,
						"apagados", r.Deleted,
						"bytes_liberados", r.BytesLiberados,
						"mantidos_por_graca", r.MantidosPorGraca,
					)
				}
			}
		}
	}()

	return cancel
}

// ResultadoColeta summarizes one pass.
type ResultadoColeta struct {
	Users            int
	Deleted          int
	BytesLiberados   int64
	MantidosPorGraca int
	Failures         int
}

// SweepOrphans scans the workspaces and deletes what is no longer referenced.
//
// Exported so it can run on demand (maintenance command or test).
func SweepOrphans(
	ctx context.Context,
	db *gorm.DB,
	cl *storage.Client,
	grace time.Duration,
) (ResultadoColeta, error) {
	var out ResultadoColeta
	if cl == nil || !cl.Config().Enabled() {
		return out, storage.ErrNotConfigured
	}

	var workspaces []models.Workspace
	if err := db.Find(&workspaces).Error; err != nil {
		return out, err
	}

	cutoff := time.Now().Add(-grace)
	for _, ws := range workspaces {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		out.Users++

		referenced := referencedKeys(cl, ws.Data)
		objetos, err := cl.ListPrefix(ctx, storage.UserPrefix(ws.UserID), 0)
		if err != nil {
			// A user with a problem must not stop the sweep of the others.
			slog.Warn("sweep: could not list", "user", ws.UserID, "err", err)
			out.Failures++
			continue
		}

		for _, obj := range objetos {
			if referenced[obj.Key] {
				continue
			}
			if obj.Modified.After(cutoff) {
				// It may be a recent upload not yet saved.
				out.MantidosPorGraca++
				continue
			}
			if err := cl.Delete(ctx, obj.Key); err != nil {
				slog.Warn("sweep: could not delete", "key", obj.Key, "err", err)
				out.Failures++
				continue
			}
			out.Deleted++
			out.BytesLiberados += obj.Size
		}
	}
	return out, nil
}

// referencedKeys returns the bucket keys cited in the workspace.
func referencedKeys(cl *storage.Client, payload []byte) map[string]bool {
	refs := map[string]bool{}
	if len(payload) == 0 {
		return refs
	}
	// We go through the JSON only to ensure it is valid text; the scan is textual.
	if !json.Valid(payload) {
		return refs
	}
	for _, bruta := range urlNoJSON.FindAllString(string(payload), -1) {
		if key := cl.KeyDaURL(bruta); key != "" {
			refs[key] = true
		}
	}
	return refs
}
