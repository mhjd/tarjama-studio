package studio

// Versions name the instructions used for newly completed chunks. Existing
// checkpoints retain their original prompt/model metadata during a resume.
func PromptVersion(kind string) string {
	if kind == "translate" {
		return "translation-desktop-v2"
	}
	return kind + "-v1"
}
