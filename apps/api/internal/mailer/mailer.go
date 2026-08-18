// Package mailer sends transactional emails (password reset, email
// verification). The implementation is chosen by environment:
//
//   - SMTP_HOST defined → SMTPMailer (really sends via SMTP/STARTTLS)
//   - otherwise         → LogMailer (only logs; ideal for dev and tests)
//
// The rest of the application depends only on the Mailer interface, so swapping
// the provider (SES, SendGrid, etc.) is just implementing Send and adjusting New().
package mailer

import (
	"fmt"
	"log/slog"
	"net/smtp"
	"os"
)

// Mailer sends a plain text email.
type Mailer interface {
	Send(to, subject, body string) error
}

// New returns the implementation suited to the environment.
func New() Mailer {
	if host := os.Getenv("SMTP_HOST"); host != "" {
		return &SMTPMailer{
			host: host,
			port: getenv("SMTP_PORT", "587"),
			user: os.Getenv("SMTP_USER"),
			pass: os.Getenv("SMTP_PASSWORD"),
			from: getenv("SMTP_FROM", os.Getenv("SMTP_USER")),
		}
	}
	return LogMailer{}
}

// Async wraps a Mailer to send in background: Send returns right away and the
// delivery (potentially slow, e.g.: SMTP) does not block the request. Errors are
// logged via slog (best-effort — transactional emails must not bring down the
// response to the user).
func Async(inner Mailer) Mailer {
	return &asyncMailer{inner: inner}
}

type asyncMailer struct {
	inner Mailer
}

func (a *asyncMailer) Send(to, subject, body string) error {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("mailer: panic no envio", "to", to, "recover", r)
			}
		}()
		if err := a.inner.Send(to, subject, body); err != nil {
			slog.Error("mailer: could not send", "to", to, "subject", subject, "err", err)
		}
	}()
	return nil
}

// LogMailer sends nothing — it only logs. Default in dev/test.
type LogMailer struct{}

// Send records the email in the structured log.
func (LogMailer) Send(to, subject, body string) error {
	slog.Info("email (log-mailer)", "to", to, "subject", subject, "body", body)
	return nil
}

// SMTPMailer sends via SMTP with PLAIN auth (STARTTLS on the default port 587).
type SMTPMailer struct {
	host, port, user, pass, from string
}

// Send builds and sends the message.
func (m *SMTPMailer) Send(to, subject, body string) error {
	addr := m.host + ":" + m.port
	msg := fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\n"+
			"Content-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		m.from, to, subject, body,
	)
	var auth smtp.Auth
	if m.user != "" {
		auth = smtp.PlainAuth("", m.user, m.pass, m.host)
	}
	return smtp.SendMail(addr, auth, m.from, []string{to}, []byte(msg))
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
