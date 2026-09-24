#!/usr/bin/env python3
"""The historical mixed-runtime release assembler is retired.

It combined a Gemini binary from b69c700 with newer API/frontend code. The move
away from Gemini changes credentials and requires migration 003; that assembly
would silently reintroduce the removed provider. Its reproducible historical
implementation remains in git at 86918ba, alongside the last qualified recipe.
"""
raise SystemExit(
    "Historical Gemini release retired. Use make web-build and make web-api-image "
    "for the complete candidate; qualify Parallel and migration 003 before deployment."
)
