package utils

import (
	"errors"
	"time"

	"github.com/cachyosso/omniboard/internal/config"
	"github.com/cachyosso/omniboard/internal/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type tokenType string

const (
	accessType  tokenType = "access"
	refreshType tokenType = "refresh"
)

// Claims are the data carried in the JWT. sid identifies the session (a row in
// `sessions`) to allow individual revocation/logout.
type Claims struct {
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	SessionID string    `json:"sid"`
	TokenType tokenType `json:"token_type"`
	jwt.RegisteredClaims
}

// TokenPair holds the generated token pair.
type TokenPair struct {
	AccessToken  string
	RefreshToken string
}

// GenerateTokenPair creates access + refresh tokens for a user, tied to a
// session (sid). The same sid goes into both tokens.
func GenerateTokenPair(u *models.User, cfg *config.JWTConfig, sid string) (*TokenPair, error) {
	access, err := signToken(u, sid, accessType, cfg.SecretKey, cfg.AccessExpirationTime)
	if err != nil {
		return nil, err
	}
	refresh, err := signToken(u, sid, refreshType, cfg.RefreshSecretKey, cfg.RefreshExpirationTime)
	if err != nil {
		return nil, err
	}
	return &TokenPair{AccessToken: access, RefreshToken: refresh}, nil
}

func signToken(u *models.User, sid string, tt tokenType, secret string, ttl time.Duration) (string, error) {
	claims := Claims{
		UserID:    u.ID,
		Email:     u.Email,
		SessionID: sid,
		TokenType: tt,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        uuid.NewString(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "omniboard",
			Subject:   u.ID,
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// ValidateAccessToken validates an access token.
func ValidateAccessToken(token, secret string) (*Claims, error) {
	return validate(token, secret, accessType)
}

// ValidateRefreshToken validates a refresh token.
func ValidateRefreshToken(token, secret string) (*Claims, error) {
	return validate(token, secret, refreshType)
}

func validate(tokenStr, secret string, expected tokenType) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing algorithm")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	if claims.TokenType != expected {
		return nil, errors.New("invalid token type")
	}
	if claims.UserID == "" {
		return nil, errors.New("token without a user")
	}
	return claims, nil
}
