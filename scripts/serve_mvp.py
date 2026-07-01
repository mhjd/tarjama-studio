#!/usr/bin/env python3
from __future__ import annotations

import uvicorn
from pathlib import Path
import sys


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    uvicorn.run(
        "server.main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
    )
