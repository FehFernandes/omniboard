package utils

import (
	"regexp"
	"strings"
)

var tsWord = regexp.MustCompile(`[\p{L}\p{N}]+`)

// ToTSQuery turns the user's free-form search into a safe to_tsquery
// expression with prefix (`word:*`), matching the start of words.
//
// E.g.: "joao silva" → "joao:* & silva:*"
//
// It sanitizes the input (only letters/digits become terms), so it is safe to
// interpolate via parameter into to_tsquery. Returns "" if there is no useful term.
func ToTSQuery(search string) string {
	words := tsWord.FindAllString(strings.ToLower(search), -1)
	if len(words) == 0 {
		return ""
	}
	for i, w := range words {
		words[i] = w + ":*"
	}
	return strings.Join(words, " & ")
}
