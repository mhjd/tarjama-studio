-- Preserve old encrypted credentials for reversibility, but application code no
-- longer accepts or resolves Gemini. Never reinterpret an old credential as an
-- OpenRouter key; encryption binds it to its original provider.
ALTER TABLE credentials DROP CONSTRAINT credentials_provider_check;
ALTER TABLE credentials ADD CONSTRAINT credentials_provider_check
 CHECK (provider IN ('gemini','groq','openrouter'));
