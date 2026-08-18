package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"time"

	"github.com/FehFernandes/omniboard/internal/audit"
	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
)

// recoveryCodeCount is how many recovery codes we generate when enabling 2FA.
const recoveryCodeCount = 10

// Enroll starts the 2FA setup: generates a TOTP secret (NOT active yet) and
// returns the secret + the otpauth:// URI for the authenticator app (QR code).
// 2FA only takes effect after confirming a code at /2fa/verify.
// POST /api/auth/2fa/enroll  (authenticated)
func (h *AuthHandler) Enroll(c *fiber.Ctx) error {
	userID := middleware.UserID(c)

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return utils.Error(c, fiber.StatusNotFound, "User not found")
	}
	if user.TwoFactorEnabled() {
		return utils.Error(c, fiber.StatusConflict, "2FA is already enabled")
	}

	secret, err := utils.GenerateTOTPSecret()
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not generate the secret")
	}
	if err := h.db.Model(&user).Update("totp_secret", secret).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not save the secret")
	}

	issuer := os.Getenv("TOTP_ISSUER")
	if issuer == "" {
		issuer = "omniboard"
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{
		"secret":      secret,
		"otpauth_url": utils.OTPAuthURL(secret, issuer, user.Email),
	})
}

type twoFactorVerifyRequest struct {
	Code string `json:"code"`
}

// Verify confirms the enroll: validates a TOTP code against the pending secret,
// enables 2FA and returns the recovery codes (shown ONE single time).
// POST /api/auth/2fa/verify  (authenticated)
func (h *AuthHandler) Verify(c *fiber.Ctx) error {
	userID := middleware.UserID(c)

	var req twoFactorVerifyRequest
	if err := c.BodyParser(&req); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return utils.Error(c, fiber.StatusNotFound, "User not found")
	}
	if user.TwoFactorEnabled() {
		return utils.Error(c, fiber.StatusConflict, "2FA is already enabled")
	}
	if user.TOTPSecret == "" {
		return utils.Error(c, fiber.StatusBadRequest, "Start the 2FA enrollment first")
	}
	if !utils.ValidateTOTP(user.TOTPSecret, req.Code) {
		return utils.Error(c, fiber.StatusUnauthorized, "Invalid code")
	}

	codes, err := h.generateRecoveryCodes(userID)
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not generate recovery codes")
	}

	now := time.Now()
	if err := h.db.Model(&user).Update("totp_enabled_at", now).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not enable 2FA")
	}

	recordAudit(h.db, c, audit.ActionTwoFactorEnabled, "user", userID, nil)
	return utils.Success(c, fiber.StatusOK, fiber.Map{
		"message":        "2FA ativado com sucesso",
		"recovery_codes": codes,
	})
}

type twoFactorDisableRequest struct {
	Code string `json:"code"`
}

// Disable turns 2FA off. It requires a valid code (TOTP OR a recovery code) —
// there is no password to reauthenticate in this app, so the second factor
// itself is the proof. It removes the secret and the recovery codes.
// POST /api/auth/2fa/disable  (authenticated)
func (h *AuthHandler) Disable(c *fiber.Ctx) error {
	userID := middleware.UserID(c)

	var req twoFactorDisableRequest
	if err := c.BodyParser(&req); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return utils.Error(c, fiber.StatusNotFound, "User not found")
	}
	if !user.TwoFactorEnabled() {
		return utils.Error(c, fiber.StatusBadRequest, "2FA is not enabled")
	}
	if !h.verifyTwoFactor(&user, req.Code) {
		return utils.Error(c, fiber.StatusUnauthorized, "Invalid code")
	}
	if !h.verifyTwoFactor(&user, req.Code) {
		return utils.Error(c, fiber.StatusUnauthorized, "Invalid code")
	}

	if err := h.db.Model(&user).Updates(map[string]interface{}{
		"totp_secret":     "",
		"totp_enabled_at": nil,
	}).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not disable 2FA")
	}
	h.db.Where("user_id = ?", userID).Delete(&models.TwoFactorRecoveryCode{})

	recordAudit(h.db, c, audit.ActionTwoFactorDisabled, "user", userID, nil)
	return utils.Success(c, fiber.StatusOK, fiber.Map{"message": "2FA desativado"})
}

// verifyTwoFactor checks a 2FA code: it accepts a valid TOTP OR an unused
// recovery code (which is then consumed). Used at login and at disable.
func (h *AuthHandler) verifyTwoFactor(user *models.User, code string) bool {
	if code == "" {
		return false
	}
	if utils.ValidateTOTP(user.TOTPSecret, code) {
		return true
	}
	var rc models.TwoFactorRecoveryCode
	err := h.db.Where("user_id = ? AND code_hash = ? AND used_at IS NULL",
		user.ID, utils.HashToken(code)).First(&rc).Error
	if err != nil {
		return false
	}
	now := time.Now()
	h.db.Model(&rc).Update("used_at", now)
	return true
}

// generateRecoveryCodes creates and persists (hashed) the recovery codes,
// replacing the previous ones. Returns the RAW values (shown only once).
func (h *AuthHandler) generateRecoveryCodes(userID string) ([]string, error) {
	h.db.Where("user_id = ?", userID).Delete(&models.TwoFactorRecoveryCode{})

	codes := make([]string, 0, recoveryCodeCount)
	for i := 0; i < recoveryCodeCount; i++ {
		b := make([]byte, 5)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		code := hex.EncodeToString(b) // 10 hex chars
		codes = append(codes, code)
		rc := models.TwoFactorRecoveryCode{UserID: userID, CodeHash: utils.HashToken(code)}
		if err := h.db.Create(&rc).Error; err != nil {
			return nil, err
		}
	}
	return codes, nil
}
